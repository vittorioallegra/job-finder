import { z } from "zod";
import { JobFilterSchema } from "@job-finder/core/filters";

/**
 * Scores the open jobs. `consent` must be true when the AI provider is a cloud service, because the
 * profile's ranking fields are sent to it (the same rule as the CV import). The run covers the jobs
 * that pass the hard filters of `filter` (the jobs screen's filter), the jobs listed in
 * `visibleJobIds` first. Without a filter, every open job is a candidate.
 */
export const ScoreStartRequestSchema = z.strictObject({
  consent: z.boolean(),
  filter: JobFilterSchema.optional(),
  visibleJobIds: z.array(z.string().min(1).max(64)).max(500).default([]),
});

export type ScoreStartRequest = z.input<typeof ScoreStartRequestSchema>;

/** Why a scoring run could not start or stopped early. */
export type ScoreStartFailureCode =
  | "no-profile"
  | "consent-required"
  | "ai-unavailable"
  | "already-running"
  | "engine-unavailable"
  | "store-failed";

export interface ScoreStartCounts {
  scored: number;
  cached: number;
  failed: number;
  skipped: number;
}

export type ScoreStartResult =
  ({ ok: true } & ScoreStartCounts) | { ok: false; code: ScoreStartFailureCode };
