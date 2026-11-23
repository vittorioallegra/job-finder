// protects=the engine answers pings and database batches served by main, and after a crash the supervisor logs the exit, marks runs left running as interrupted and serves the restarted engine;
// fails_when=a ping or a batch returns the wrong results, a run stays running after its engine crashed, the exit reason is not logged, or no restart happens;
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
import { startEngineSupervisor, type EngineHandle, type EngineSupervisor } from "./supervisor";

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
      reconcileInterruptedRuns: () => reconcileInterruptedRuns(database.db),
    },
    log: (level, message) => logs.push(`${level}: ${message}`),
    restartDelayMs: 1,
    maxRestarts: 3,
  });
  const harness = { supervisor, launches, logs, database };
  harnesses.push(harness);
  return harness;
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
});
