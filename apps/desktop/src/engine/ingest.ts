import {
  runIngestion,
  type BatchPlan,
  type ExistingState,
  type IngestCompany,
  type IngestStore,
  type LookupRequest,
} from "@job-finder/core/ingest";
import {
  INGEST_RUN_KIND,
  type IngestEvent,
  type IngestRunOutcome,
} from "@job-finder/core/ingest/events";
import type { HttpClient } from "@job-finder/core/net";
import type { DbCall, DbResult, EngineToMainMessage, IngestStartCode } from "./protocol";

/** Starts and cancels ingestion runs. The engine runs at most one at a time. */
export interface IngestController {
  start(runId: string): IngestStartCode;
  cancel(runId: string): void;
}

export interface IngestControllerOptions {
  db(calls: DbCall[]): Promise<DbResult[]>;
  send(message: EngineToMainMessage): void;
  http: HttpClient;
  now?: () => number;
}

/** Marks a progress event that is not stored: a run that failed before its own log could be written. */
const UNSTORED_SEQ = -1;

export function createIngestController(options: IngestControllerOptions): IngestController {
  const now = options.now ?? (() => Date.now());
  let active: { runId: string; controller: AbortController } | undefined;

  return {
    start(runId) {
      if (active) return "already-running";
      const controller = new AbortController();
      active = { runId, controller };

      // The final event is held back until the run row is closed, so main can accept a new run
      // as soon as it sees it.
      let finalEvent: IngestEvent | undefined;
      const store = createDbIngestStore(options.db, (event) => {
        if (event.kind === "run-finished") {
          finalEvent = event;
          return;
        }
        options.send({ type: "ingest-progress", event });
      });

      void runIngestion({ runId, store, http: options.http, signal: controller.signal, now }).then(
        () => {
          active = undefined;
          if (finalEvent) options.send({ type: "ingest-progress", event: finalEvent });
        },
        () => {
          active = undefined;
          options.send({
            type: "ingest-progress",
            event: {
              runId,
              seq: UNSTORED_SEQ,
              at: now(),
              kind: "run-finished",
              status: "failed",
            },
          });
        },
      );
      return "accepted";
    },
    cancel(runId) {
      if (active?.runId === runId) active.controller.abort();
    },
  };
}

/** The database calls of one ingestion run, batched per step. `onEvent` sees every event before it is sent. */
export function createDbIngestStore(
  db: (calls: DbCall[]) => Promise<DbResult[]>,
  onEvent: (event: IngestEvent) => void,
): IngestStore {
  const one = async (call: DbCall): Promise<unknown> => {
    const [result] = await db([call]);
    if (!result) throw new Error("database returned no result");
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };

  return {
    async listCompanies() {
      return (await one({ name: "companies.list" })) as IngestCompany[];
    },
    async beginRun(runId, startedAt) {
      await one({ name: "runs.start", id: runId, kind: INGEST_RUN_KIND, startedAt });
    },
    async appendEvent(event) {
      await one({ name: "run-events.append", event });
      onEvent(event);
    },
    async finishRun(runId: string, outcome: IngestRunOutcome, finishedAt: number) {
      await one({ name: "runs.finish", id: runId, status: outcome, finishedAt });
    },
    async lookup(request: LookupRequest) {
      return (await one({ name: "ingest.lookup", request })) as ExistingState;
    },
    async persist(plan: BatchPlan) {
      await one({ name: "ingest.persist", plan });
    },
    async closeMissing(companyId, runId, at) {
      return (await one({ name: "ingest.close-missing", companyId, runId, at })) as number;
    },
  };
}
