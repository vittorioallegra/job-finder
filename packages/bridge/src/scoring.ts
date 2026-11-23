import { z } from "zod";

/**
 * Scores the open jobs. `consent` must be true when the AI provider is a cloud service, because the
 * profile's ranking fields are sent to it (the same rule as the CV import).
 */
export const ScoreStartRequestSchema = z.strictObject({
  consent: z.boolean(),
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
