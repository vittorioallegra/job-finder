import type { RunStatus } from "@job-finder/core";

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

/** Messages sent by main to the engine over the message port. */
export type MainToEngineMessage =
  { type: "ping"; id: number } | { type: "db-result"; id: number; results: DbResult[] };

/** Messages sent by the engine to main over the message port. */
export type EngineToMainMessage =
  { type: "pong"; id: number } | { type: "db"; id: number; calls: DbCall[] };
