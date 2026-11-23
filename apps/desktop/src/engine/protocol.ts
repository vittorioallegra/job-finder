import type { RunStatus } from "@job-finder/core";
import type { AiConnectionResult, AiProviderConfig } from "@job-finder/core/ai";
import type { CvImportOutcome, CvImportRequest } from "@job-finder/core/cv";
import type {
  DiscoveryCriteria,
  DiscoveryOutcome,
  SearchSourceConfig,
} from "@job-finder/core/discovery/types";
import type { BatchPlan, LookupRequest } from "@job-finder/core/ingest";
import type { IngestEvent } from "@job-finder/core/ingest/events";
import type { PageRenderResult } from "@job-finder/core/net";

/**
 * Database operations the engine may request. Main owns the database and executes these in
 * order; the engine never opens SQLite itself.
 */
export type DbCall =
  | { name: "settings.get"; key: string }
  | { name: "settings.set"; key: string; value: string }
  | { name: "runs.start"; id: string; kind: string; startedAt: number }
  | { name: "runs.finish"; id: string; status: Exclude<RunStatus, "running">; finishedAt: number }
  | { name: "runs.list"; limit: number }
  | { name: "companies.list" }
  /** Existing jobs and source rows for one batch, read before the batch is planned. */
  | { name: "ingest.lookup"; request: LookupRequest }
  | { name: "ingest.persist"; plan: BatchPlan }
  /** Closes the postings of one company that its complete scan did not see; returns how many. */
  | { name: "ingest.close-missing"; companyId: string; runId: string; at: number }
  | { name: "run-events.append"; event: IngestEvent };

export type DbResult = { ok: true; value: unknown } | { ok: false; error: string };

/** How the engine answered a request to start an ingestion run. */
export type IngestStartCode = "accepted" | "already-running";

/**
 * Messages sent by main to the engine over the message port. `ai-test` carries the API key from
 * main to the engine: the only path a secret value takes out of main, and it never reaches the
 * renderer.
 */
export type MainToEngineMessage =
  | { type: "ping"; id: number }
  | { type: "db-result"; id: number; results: DbResult[] }
  | { type: "ai-test"; id: number; config: AiProviderConfig }
  /** The CV bytes and the API key travel to the engine only; the outcome carries no CV text. */
  | { type: "cv-import"; id: number; request: CvImportRequest }
  /** The answer to a `page-render` request: the page HTML, or a code. */
  | { type: "page-render-result"; id: number; result: PageRenderResult }
  /** `companyId` limits the run to one company (a retry); omitted: every company. */
  | { type: "ingest-start"; id: number; runId: string; companyId?: string }
  | { type: "ingest-cancel"; runId: string }
  /**
   * Web search for ATS boards. The engine makes the requests; main relays the criteria, the enabled
   * sources and, for keyed providers, their keys (the only path a search key takes out of main).
   */
  | { type: "discover-companies"; id: number; criteria: DiscoveryCriteria; config: SearchSourceConfig };

/** Messages sent by the engine to main over the message port. */
export type EngineToMainMessage =
  | { type: "pong"; id: number }
  | { type: "db"; id: number; calls: DbCall[] }
  | { type: "ai-test-result"; id: number; result: AiConnectionResult }
  | { type: "cv-import-result"; id: number; outcome: CvImportOutcome }
  /** Asks main to load a JavaScript-rendered page in its hidden, hardened loader window. */
  | { type: "page-render"; id: number; url: string }
  | { type: "ingest-start-result"; id: number; code: IngestStartCode }
  | { type: "discover-companies-result"; id: number; outcome: DiscoveryOutcome }
  /** A run's progress and log entries. The final `run-finished` is sent after the run row is closed. */
  | { type: "ingest-progress"; event: IngestEvent };
