/**
 * Why an AI connection test failed. The first eight mirror the AI layer's error codes in
 * packages/core/src/ai; `engine-unavailable` means the engine process could not answer.
 */
export const AI_TEST_FAILURE_CODES = [
  "not-configured",
  "invalid-key",
  "model-not-found",
  "rate-limited",
  "unreachable",
  "invalid-output",
  "unknown",
  "engine-unavailable",
] as const;
export type AiTestFailureCode = (typeof AI_TEST_FAILURE_CODES)[number];

/** Outcome of "test connection" with the saved AI settings. Never carries the key or a provider error body. */
export type AiTestResult = { ok: true; model: string } | { ok: false; code: AiTestFailureCode };
