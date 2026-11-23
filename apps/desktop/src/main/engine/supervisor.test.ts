// protects=the engine answers pings and database batches served by main, page renders and ingestion and scoring requests are answered under their request ids, and after a crash the supervisor logs the exit,
// fails_when=a ping or a batch returns the wrong results, a page render gets no answer or another request's answer, an ingestion answer or progress is lost or sent to another run, a run stays running after its engine crashed, the exit reason is not logged, the owner is not told about a crash, no restart happens (including when reconciling runs fails), or a call hangs instead of rejecting;
// no_claim=utility-process spawning, the real MessageChannelMain wiring and the bundled engine entry are covered by the desktop E2E smoke, not here.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EventEmitter } from "node:events";
import { MessageChannel, type MessagePort } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { openAppDatabase, type AppDatabase } from "../db/database";
import { executeDbCalls, reconcileInterruptedRuns } from "../db/operations";
import type { AiProviderConfig } from "@job-finder/core/ai";
import type { CvImportRequest } from "@job-finder/core/cv";
import type { IngestEvent } from "@job-finder/core/ingest/events";
import type { HttpClient } from "@job-finder/core/net";
import { emptyProfile, scoringFields } from "@job-finder/core/profile";
import type { PortLike } from "../../engine/port";
import { createEngineRuntime, type EngineRuntime } from "../../engine/runtime";
import {
  EngineUnavailableError,
  startEngineSupervisor,
  type EngineHandle,
  type EngineSupervisor,
} from "./supervisor";

function fakeNet(): HttpClient {
  return {
    resolve: (url) => url,
    isAllowed: async () => true,
    get: async (url) => ({ ok: false, code: "network", url }),
    post: async (url) => ({ ok: false, code: "network", url }),
  };
}

function toPortLike(port: MessagePort): PortLike {
  return {
    postMessage: (message) => port.postMessage(message),
    on: (_event, listener) => port.on("message", listener),
    start: () => port.start(),
    close: () => port.close(),
  };
}

interface EngineLaunch {
  runtime: EngineRuntime;
  crash(): void;
}

interface Harness {
  supervisor: EngineSupervisor;
  launches: EngineLaunch[];
  logs: string[];
  database: AppDatabase;
  /** When `deadOnArrival` is true, each new engine dies before it can answer a ping. When `reconcileFails` is true, reconciling runs rejects. */
  control: {
    deadOnArrival: boolean;
    reconcileFails: boolean;
    /** When true, AI connection tests never get an answer, so a crash has to reject them. */
    aiHangs: boolean;
    /** Configs the engine received for AI connection tests. */
    aiConfigs: AiProviderConfig[];
    cvRequests: CvImportRequest[];
    /** URLs main was asked to render through the page loader. */
    pageUrls: string[];
    /** Answer the engine gives to a request to start a run. */
    ingestAnswer: "accepted" | "already-running";
    ingestStarts: string[];
    ingestCancels: string[];
    ingestEvents: IngestEvent[];
    engineLosses: number;
    discoveries: string[];
    scorings: Array<{ jobIds: string[]; apiKey: string | null }>;
  };
}

const repoMigrations = resolve(__dirname, "../../../drizzle");
const harnesses: Harness[] = [];

async function startHarness(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "job-finder-engine-"));
  const database = await openAppDatabase({
    file: join(dir, "job-finder.sqlite"),
    migrationsFolder: repoMigrations,
    backupDirectory: join(dir, "backups"),
  });
  const launches: EngineLaunch[] = [];
  const logs: string[] = [];
  const control: Harness["control"] = {
    deadOnArrival: false,
    reconcileFails: false,
    aiHangs: false,
    aiConfigs: [],
    cvRequests: [],
    pageUrls: [],
    ingestAnswer: "accepted",
    ingestStarts: [],
    ingestCancels: [],
    ingestEvents: [],
    engineLosses: 0,
    discoveries: [],
    scorings: [],
  };
  const launch = (): EngineHandle => {
    const { port1, port2 } = new MessageChannel();
    const runtime = createEngineRuntime(toPortLike(port2), {
      net: fakeNet(),
      createScoring: () => ({
        score: async (request) => {
          control.scorings.push({ jobIds: request.jobIds, apiKey: request.ai.config.apiKey });
          return { ok: true, scored: request.jobIds.length, cached: 0, failed: 0, skipped: 0 };
        },
      }),
      testAiConnection: (config) => {
        control.aiConfigs.push(config);
        if (control.aiHangs) {
          return new Promise(() => {});
        }
        return Promise.resolve({ ok: true, model: config.model });
      },
      discoverCompanies: async (criteria) => {
        control.discoveries.push(criteria.keywords.join(","));
        return { ok: true, candidates: [] };
      },
      importCv: async (request) => {
        control.cvRequests.push(request);
        return { ok: false, code: "invalid-output" };
      },
      createIngest: (api) => ({
        start: (runId) => {
          control.ingestStarts.push(runId);
          // Progress goes out before the answer, as the real controller does.
          api.send({
            type: "ingest-progress",
            event: { runId, seq: 0, at: 1, kind: "run-started" },
          });
          return control.ingestAnswer;
        },
        cancel: (runId) => {
          control.ingestCancels.push(runId);
        },
      }),
    });
    const exit = new EventEmitter();
    launches.push({
      runtime,
      crash: () => {
        runtime.close();
        exit.emit("exit", 1);
      },
    });
    if (control.deadOnArrival) {
      // Closing before any message is read means the ping is never answered.
      runtime.close();
      setImmediate(() => exit.emit("exit", 1));
    }
    return {
      port: toPortLike(port1),
      onExit: (listener) => {
        exit.on("exit", listener);
      },
      stop: () => {
        runtime.close();
      },
    };
  };
  const supervisor = startEngineSupervisor({
    launch,
    pages: {
      render: async (url) => {
        control.pageUrls.push(url);
        return { ok: true, url, html: "<main>job</main>" };
      },
    },
    database: {
      execute: (calls) => executeDbCalls(database.db, calls),
      reconcileInterruptedRuns: () =>
        control.reconcileFails
          ? Promise.reject(new Error("reconcile boom"))
          : reconcileInterruptedRuns(database.db),
    },
    log: (level, message) => logs.push(`${level}: ${message}`),
    restartDelayMs: 1,
    maxRestarts: 3,
    onIngestEvent: (event) => control.ingestEvents.push(event),
    onEngineLost: () => {
      control.engineLosses += 1;
    },
  });
  const harness = { supervisor, launches, logs, database, control };
  harnesses.push(harness);
  return harness;
}

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("condition not met in time");
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`still pending after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    harness.supervisor.stop();
    harness.database.close();
  }
});

describe("engine supervisor", () => {
  it("answers a ping and round-trips a write batch followed by a read through main", async () => {
    const { supervisor, launches } = await startHarness();
    await supervisor.ping();

    const results = await (launches[0] as EngineLaunch).runtime.db([
      { name: "settings.set", key: "theme", value: "dark" },
      { name: "settings.get", key: "theme" },
    ]);
    expect(results).toEqual([
      { ok: true, value: null },
      { ok: true, value: "dark" },
    ]);
  });

  it("restarts after a crash, marks the run left running as interrupted and serves the new engine", async () => {
    const { supervisor, launches, logs } = await startHarness();
    await supervisor.ping();
    await launches[0]?.runtime.db([
      { name: "runs.start", id: "run-1", kind: "ingest", startedAt: 1 },
    ]);

    launches[0]?.crash();
    await supervisor.ping();

    expect(launches).toHaveLength(2);
    expect(logs).toContain("error: engine exited with code 1; 1 run(s) marked interrupted");
    const [listed] = (await launches[1]?.runtime.db([{ name: "runs.list", limit: 10 }])) ?? [];
    expect(listed).toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          id: "run-1",
          kind: "ingest",
          status: "interrupted",
          finishedAt: expect.any(Number),
        }),
      ],
    });
  });

  it("still restarts the engine when reconciling runs fails, and logs the failure", async () => {
    const { supervisor, launches, logs, control } = await startHarness();
    await supervisor.ping();

    control.reconcileFails = true;
    launches[0]?.crash();
    await supervisor.ping();
    control.reconcileFails = false;

    expect(launches).toHaveLength(2);
    expect(logs).toContain(
      "error: engine exited with code 1; reconciling runs failed: reconcile boom",
    );
    expect(supervisor.state).toBe("running");
  });

  it("rejects a ping in flight when the engine crashes", async () => {
    const { supervisor, launches } = await startHarness();
    await supervisor.ping();

    const inFlight = expect(supervisor.ping()).rejects.toBeInstanceOf(EngineUnavailableError);
    launches[0]?.crash();
    await inFlight;
    await expect(supervisor.ping()).resolves.toBeUndefined();
  });

  it("rejects calls at once after giving up, and logs the give-up once", async () => {
    const { supervisor, launches, logs, control } = await startHarness();
    await supervisor.ping();

    control.deadOnArrival = true;
    launches[0]?.crash();
    const queued = expect(supervisor.ping()).rejects.toMatchObject({ reason: "gave_up" });
    await waitFor(() => supervisor.state === "failed");
    await queued;

    expect(launches).toHaveLength(4);
    await expect(withTimeout(supervisor.ping(), 200)).rejects.toMatchObject({
      name: "EngineUnavailableError",
      reason: "gave_up",
    });
    expect(logs.filter((line) => line.startsWith("error: engine crashed"))).toEqual([
      "error: engine crashed 4 times in a row; not restarting",
    ]);
  });

  it("moves through running, restarting and running again, then failed after giving up", async () => {
    const { supervisor, launches, control } = await startHarness();
    expect(supervisor.state).toBe("running");
    await supervisor.ping();
    expect(supervisor.state).toBe("running");

    launches[0]?.crash();
    expect(supervisor.state).toBe("restarting");
    await supervisor.ping();
    expect(supervisor.state).toBe("running");

    control.deadOnArrival = true;
    launches[1]?.crash();
    await waitFor(() => supervisor.state === "failed");
    expect(launches).toHaveLength(5);
  });

  it("runs an AI connection test in the engine and hands it the key only there", async () => {
    const { supervisor, control } = await startHarness();
    const result = await supervisor.testAiConnection({
      provider: "openai-compatible",
      model: "local-model",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "sk-test-key",
    });
    expect(result).toEqual({ ok: true, model: "local-model" });
    expect(control.aiConfigs).toEqual([expect.objectContaining({ apiKey: "sk-test-key" })]);
  });

  it("runs a CV import in the engine and hands it the key and the bytes only there", async () => {
    const { supervisor, control } = await startHarness();
    const outcome = await supervisor.importCv({
      config: {
        provider: "openai-compatible",
        model: "local-model",
        baseUrl: "http://localhost:11434/v1",
        apiKey: "sk-cv-key",
      },
      contextSize: 8192,
      fileName: "cv.txt",
      bytes: new Uint8Array([72, 105]),
    });
    expect(outcome).toEqual({ ok: false, code: "invalid-output" });
    expect(control.cvRequests).toEqual([
      expect.objectContaining({
        fileName: "cv.txt",
        bytes: new Uint8Array([72, 105]),
        config: expect.objectContaining({ apiKey: "sk-cv-key" }),
      }),
    ]);
  });

  it("rejects an AI connection test in flight when the engine crashes", async () => {
    const { supervisor, launches, control } = await startHarness();
    await supervisor.ping();

    control.aiHangs = true;
    const inFlight = expect(
      supervisor.testAiConnection({
        provider: "anthropic",
        model: "claude-test",
        baseUrl: "",
        apiKey: "sk-test-key",
      }),
    ).rejects.toMatchObject({ name: "EngineUnavailableError", reason: "crashed" });
    launches[0]?.crash();
    await inFlight;
    control.aiHangs = false;
  });

  it("rejects calls waiting for a restart when the supervisor is stopped", async () => {
    const { supervisor, launches } = await startHarness();
    await supervisor.ping();

    launches[0]?.crash();
    const waiting = expect(supervisor.ping()).rejects.toMatchObject({ reason: "stopped" });
    supervisor.stop();
    await waiting;
    await expect(withTimeout(supervisor.ping(), 200)).rejects.toMatchObject({ reason: "stopped" });
  });
  it("loads a page render the engine asks for through main and answers under the same id", async () => {
    const { supervisor, launches, control } = await startHarness();
    await supervisor.ping();

    const result = await (launches[0] as EngineLaunch).runtime.renderPage(
      "https://jobs.example.test/careers",
    );

    expect(result).toEqual({
      ok: true,
      url: "https://jobs.example.test/careers",
      html: "<main>job</main>",
    });
    expect(control.pageUrls).toEqual(["https://jobs.example.test/careers"]);
  });

  it("starts an ingestion run in the engine, forwards its progress and passes a cancel on", async () => {
    const { supervisor, control } = await startHarness();

    await expect(supervisor.startIngestion("run-1")).resolves.toBe("accepted");
    await waitFor(() => control.ingestEvents.length === 1);
    supervisor.cancelIngestion("run-1");
    await waitFor(() => control.ingestCancels.length === 1);

    expect(control.ingestStarts).toEqual(["run-1"]);
    expect(control.ingestEvents).toEqual([
      expect.objectContaining({ runId: "run-1", kind: "run-started" }),
    ]);
    expect(control.ingestCancels).toEqual(["run-1"]);
  });

  it("runs a company search in the engine and answers under its request id", async () => {
    const { supervisor, control } = await startHarness();

    await expect(
      supervisor.discoverCompanies(
        { keywords: ["data", "ml"], locations: [] },
        { duckduckgo: true, keyed: [] },
      ),
    ).resolves.toEqual({ ok: true, candidates: [] });
    expect(control.discoveries).toEqual(["data,ml"]);
  });

  it("scores jobs in the engine, hands it the key only there, and answers under its request id", async () => {
    const { supervisor, control } = await startHarness();

    const outcome = await supervisor.scoreJobs({
      profile: scoringFields(emptyProfile()),
      profileVersion: 2,
      jobIds: ["j1", "j2"],
      language: "en",
      ai: {
        config: {
          provider: "openai-compatible",
          model: "local-model",
          baseUrl: "http://localhost:11434/v1",
          apiKey: "sk-test-key",
        },
        contextSize: 8192,
      },
    });

    expect(outcome).toEqual({ ok: true, scored: 2, cached: 0, failed: 0, skipped: 0 });
    expect(control.scorings).toEqual([{ jobIds: ["j1", "j2"], apiKey: "sk-test-key" }]);
  });

  it("reports the engine's answer when a run is already active", async () => {
    const { supervisor, control } = await startHarness();
    control.ingestAnswer = "already-running";

    await expect(supervisor.startIngestion("run-2")).resolves.toBe("already-running");
  });

  it("reports an engine crash to the owner once, and only when the crash is unexpected", async () => {
    const { supervisor, launches, control } = await startHarness();
    await supervisor.ping();

    launches[0]?.crash();
    await supervisor.ping();

    expect(control.engineLosses).toBe(1);
  });
});
