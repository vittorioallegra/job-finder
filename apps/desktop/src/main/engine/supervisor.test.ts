// protects=the engine answers pings and database batches served by main, and after a crash the supervisor logs the exit, marks runs left running as interrupted and serves the restarted engine; calls in flight at a crash, or made after the supervisor gave up or stopped, reject with EngineUnavailableError instead of hanging;
// fails_when=a ping or a batch returns the wrong results, a run stays running after its engine crashed, the exit reason is not logged, no restart happens (including when reconciling runs fails), or a call hangs instead of rejecting;
// no_claim=utility-process spawning, the real MessageChannelMain wiring and the bundled engine entry are covered by the desktop E2E smoke, not here.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EventEmitter } from "node:events";
import { MessageChannel, type MessagePort } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { openAppDatabase, type AppDatabase } from "../db/database";
import { executeDbCalls, reconcileInterruptedRuns } from "../db/operations";
import type { PortLike } from "../../engine/port";
import { createEngineRuntime, type EngineRuntime } from "../../engine/runtime";
import {
  EngineUnavailableError,
  startEngineSupervisor,
  type EngineHandle,
  type EngineSupervisor,
} from "./supervisor";

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
  control: { deadOnArrival: boolean; reconcileFails: boolean };
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
  const control = { deadOnArrival: false, reconcileFails: false };
  const launch = (): EngineHandle => {
    const { port1, port2 } = new MessageChannel();
    const runtime = createEngineRuntime(toPortLike(port2));
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

  it("rejects calls waiting for a restart when the supervisor is stopped", async () => {
    const { supervisor, launches } = await startHarness();
    await supervisor.ping();

    launches[0]?.crash();
    const waiting = expect(supervisor.ping()).rejects.toMatchObject({ reason: "stopped" });
    supervisor.stop();
    await waiting;
    await expect(withTimeout(supervisor.ping(), 200)).rejects.toMatchObject({ reason: "stopped" });
  });
});
