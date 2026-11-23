import type { RunStatus } from "@job-finder/core";
import type { AiConnectionResult, AiProviderConfig } from "@job-finder/core/ai";
import type { CvImportOutcome, CvImportRequest } from "@job-finder/core/cv";
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
  | { name: "runs.list"; limit: number };

export type DbResult = { ok: true; value: unknown } | { ok: false; error: string };

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
  | { type: "page-render-result"; id: number; result: PageRenderResult };

/** Messages sent by the engine to main over the message port. */
export type EngineToMainMessage =
  | { type: "pong"; id: number }
  | { type: "db"; id: number; calls: DbCall[] }
  | { type: "ai-test-result"; id: number; result: AiConnectionResult }
  | { type: "cv-import-result"; id: number; outcome: CvImportOutcome }
  /** Asks main to load a JavaScript-rendered page in its hidden, hardened loader window. */
  | { type: "page-render"; id: number; url: string };
