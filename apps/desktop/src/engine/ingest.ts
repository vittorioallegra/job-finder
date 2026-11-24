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
import { createAiModel, type AiModelHandle } from "@job-finder/core/ai";
import { scanCareersPage, type CareersAi } from "@job-finder/core/careers";
import type { HttpClient, PageRenderResult } from "@job-finder/core/net";
import type {
  DbCall,
  DbResult,
  EngineToMainMessage,
  IngestAiSettings,
  IngestStartCode,
} from "./protocol";

/** Starts and cancels ingestion runs. The engine runs at most one at a time. */
export interface IngestController {
  /** `ai` is the provider for generic careers pages; omitted, those pages fail with `ai-unavailable`. */
  start(runId: string, companyId?: string, ai?: IngestAiSettings): IngestStartCode;
  cancel(runId: string): void;
}

export interface IngestControllerOptions {
  db(calls: DbCall[]): Promise<DbResult[]>;
  send(message: EngineToMainMessage): void;
  /** Renders a JavaScript careers page through main's hidden loader. */
  renderPage(url: string): Promise<PageRenderResult>;
  http: HttpClient;
  now?: () => number;
}

/** Builds the model for one run. An unusable configuration means no AI for that run, not a crash. */
function careersAi(ai: IngestAiSettings | undefined): CareersAi | undefined {
  if (!ai) return undefined;
  let handle: AiModelHandle;
  try {
    handle = createAiModel({ ...ai.config, contextSize: ai.contextSize });
  } catch {
    return undefined;
  }
  return { model: handle.model, capabilities: handle.capabilities, contextSize: ai.contextSize };
}

/** Marks a progress event that is not stored: a run that failed before its own log could be written. */
const UNSTORED_SEQ = -1;

export function createIngestController(options: IngestControllerOptions): IngestController {
  const now = options.now ?? (() => Date.now());
  let active: { runId: string; controller: AbortController } | undefined;

  return {
    start(runId, companyId, ai) {
      if (active) return "already-running";
      const controller = new AbortController();
      active = { runId, controller };
      const careers = careersAi(ai);

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

      void runIngestion({
        runId,
        store,
        http: options.http,
        signal: controller.signal,
        now,
        companyId,
        scanCareers: (target) =>
          scanCareersPage(target, {
            http: options.http,
            ai: careers,
            renderPage: options.renderPage,
            signal: controller.signal,
          }),
      }).then(
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
