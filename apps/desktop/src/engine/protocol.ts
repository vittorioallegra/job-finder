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
import type { ExplanationLanguage, ScoreOutcome, StoredScore } from "@job-finder/core/ranking";
import type { ScoringFields, Profile } from "@job-finder/core/profile";
import type { DocumentJob } from "@job-finder/core/documents/prompt";
import type { DocumentKind } from "@job-finder/core/documents/schema";
import type { GenerateDocumentOutcome } from "@job-finder/core/documents/generate";
import type { FormField } from "@job-finder/core/ats/autofill";
import type { AutofillMapOutcome } from "@job-finder/core/ats/autofill/ai";
import type { DocumentLanguage } from "@job-finder/core/documents/language";
import type { UpdateCheckOutcome } from "@job-finder/core/updates";

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
  | { name: "run-events.append"; event: IngestEvent }
  /** The scoring inputs of the jobs, in the order of `jobIds`; ids no longer open or stored are left out. */
  | { name: "scores.jobs"; jobIds: string[] }
  /** The stored scores of these jobs for one profile version. */
  | { name: "scores.lookup"; profileVersion: number; jobIds: string[] }
  | { name: "scores.persist"; rows: StoredScore[] };

export type DbResult = { ok: true; value: unknown } | { ok: false; error: string };

/** How the engine answered a request to start an ingestion run. */
export type IngestStartCode = "accepted" | "already-running";

/**
 * The AI provider a run may use for generic careers pages. Main builds it from settings and the
 * saved key; the key stays in the engine. Omitted: generic careers pages fail with `ai-unavailable`.
 */
export interface IngestAiSettings {
  config: AiProviderConfig;
  /** Configured context size of the model, in tokens. */
  contextSize: number;
}

/**
 * One scoring request. The engine gets only the ranking fields of the profile and the AI provider
 * with its key; the key is used for the run and never stored.
 */
export interface ScoreJobsRequest {
  profile: ScoringFields;
  profileVersion: number;
  /** Jobs in scoring order: visible and top jobs first. */
  jobIds: string[];
  /** The language of the explanations: the user's UI language. */
  language: ExplanationLanguage;
  ai: IngestAiSettings;
}

/** A scoring outcome. `store-failed`: a database call of the run failed. */
export type ScoreJobsOutcome = ScoreOutcome | { ok: false; code: "store-failed" };

/**
 * One document request. The engine gets the profile and the posting it needs, and the AI provider
 * with its key; the key is used for the call and never stored. Nothing is written to the database
 * here: main stores the answer.
 */
export interface GenerateDocumentRequest {
  kind: DocumentKind;
  profile: Profile;
  job: DocumentJob;
  /** The language of the text: the user's UI language. */
  language: ExplanationLanguage;
  ai: IngestAiSettings;
}

/**
 * One request to map the fields the rules left, with the AI. The engine gets the fields the rules
 * could not map, the profile and the AI provider with its key; nothing is stored.
 */
export interface MapFormFieldsRequest {
  fields: FormField[];
  profile: Profile;
  /** The language of the drafts: the posting's, or the UI's when the posting's is not supported. */
  language: DocumentLanguage;
  ai: IngestAiSettings;
}

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
  | { type: "ingest-start"; id: number; runId: string; companyId?: string; ai?: IngestAiSettings }
  | { type: "ingest-cancel"; runId: string }
  /** Affinity scoring of open jobs with the AI; the answer is `score-jobs-result`. */
  | { type: "score-jobs"; id: number; request: ScoreJobsRequest }
  /** A tailored CV or cover letter with the AI; the answer is `generate-document-result`. */
  | { type: "generate-document"; id: number; request: GenerateDocumentRequest }
  /** Maps the fields the rules left with the AI; the answer is `map-form-fields-result`. */
  | { type: "map-form-fields"; id: number; request: MapFormFieldsRequest }
  /**
   * Asks GitHub for the latest release. The engine makes the request through its HTTP client (fixture
   * override and robots.txt apply); the answer is `check-update-result`.
   */
  | { type: "check-update"; id: number; currentVersion: string }
  /**
   * Web search for ATS boards. The engine makes the requests; main relays the criteria, the enabled
   * sources and, for keyed providers, their keys (the only path a search key takes out of main).
   */
  | {
      type: "discover-companies";
      id: number;
      criteria: DiscoveryCriteria;
      config: SearchSourceConfig;
    };

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
  | { type: "score-jobs-result"; id: number; outcome: ScoreJobsOutcome }
  | { type: "generate-document-result"; id: number; outcome: GenerateDocumentOutcome }
  | { type: "map-form-fields-result"; id: number; outcome: AutofillMapOutcome }
  /** The answer to a `check-update` request. */
  | { type: "check-update-result"; id: number; outcome: UpdateCheckOutcome }
  /** A run's progress and log entries. The final `run-finished` is sent after the run row is closed. */
  | { type: "ingest-progress"; event: IngestEvent };
