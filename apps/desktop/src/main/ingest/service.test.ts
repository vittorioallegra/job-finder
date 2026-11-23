// protects=an ingestion run starts only when the engine accepts it, one run is active at a time, progress reaches the windows, and a run whose engine died is reported interrupted;
// fails_when=a second run starts while one is active, a run is reported started when the engine refused or is gone, a finished run keeps blocking new ones, or a dead engine leaves a run looking active;
// no_claim=the engine's own run logic and the supervisor's crash handling are not exercised here; the engine and supervisor tests cover them.
import { describe, expect, it } from "vitest";
import type { IngestEvent } from "@job-finder/core/ingest/events";
import { createIngestionService, type IngestionEngine } from "./service";

interface FakeEngine extends IngestionEngine {
  started: string[];
  cancelled: string[];
  answer: "accepted" | "already-running" | "unreachable";
}

function fakeEngine(): FakeEngine {
  const engine: FakeEngine = {
    started: [],
    cancelled: [],
    answer: "accepted",
    startIngestion: async (runId) => {
      engine.started.push(runId);
      if (engine.answer === "unreachable") throw new Error("engine unavailable");
      return engine.answer;
    },
    cancelIngestion: (runId) => {
      engine.cancelled.push(runId);
    },
  };
  return engine;
}

function setup(engine: FakeEngine | null) {
  const broadcast: IngestEvent[] = [];
  let runCounter = 0;
  const service = createIngestionService({
    engine: () => engine,
    broadcast: (event) => broadcast.push(event),
    newRunId: () => `run-${++runCounter}`,
  });
  return { service, broadcast };
}

const finished = (runId: string): IngestEvent => ({
  runId,
  seq: 2,
  at: 9,
  kind: "run-finished",
  status: "succeeded",
});

describe("ingestion service", () => {
  it("starts a run the engine accepts, and refuses a second one while it is active", async () => {
    const engine = fakeEngine();
    const { service } = setup(engine);

    expect(await service.start()).toEqual({ ok: true, runId: "run-1" });
    expect(await service.start()).toEqual({ ok: false, code: "already-running" });
    expect(engine.started).toEqual(["run-1"]);
  });

  it("reports an engine that is busy or gone without marking a run active", async () => {
    const engine = fakeEngine();
    const { service } = setup(engine);

    engine.answer = "already-running";
    expect(await service.start()).toEqual({ ok: false, code: "already-running" });

    engine.answer = "unreachable";
    expect(await service.start()).toEqual({ ok: false, code: "engine-unavailable" });

    expect(await setup(null).service.start()).toEqual({ ok: false, code: "engine-unavailable" });
  });

  it("forwards progress to the windows, and lets a new run start once the old one has finished", async () => {
    const engine = fakeEngine();
    const { service, broadcast } = setup(engine);
    await service.start();

    service.handleEngineEvent({ runId: "run-1", seq: 0, at: 1, kind: "run-started" });
    expect(await service.start()).toEqual({ ok: false, code: "already-running" });
    service.handleEngineEvent(finished("run-1"));

    expect(broadcast.map((event) => event.kind)).toEqual(["run-started", "run-finished"]);
    expect(await service.start()).toEqual({ ok: true, runId: "run-2" });
  });

  it("reports an active run as interrupted when its engine is lost, and only then", async () => {
    const engine = fakeEngine();
    const { service, broadcast } = setup(engine);

    service.handleEngineLost();
    expect(broadcast).toEqual([]);

    await service.start();
    service.handleEngineLost();

    expect(broadcast).toEqual([
      expect.objectContaining({ runId: "run-1", kind: "run-finished", status: "interrupted" }),
    ]);
    expect(await service.start()).toEqual({ ok: true, runId: "run-2" });
  });

  it("passes a cancel on to the engine for the run it names", async () => {
    const engine = fakeEngine();
    const { service } = setup(engine);
    service.cancel("run-9");
    expect(engine.cancelled).toEqual(["run-9"]);
  });
});
