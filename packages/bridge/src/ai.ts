import type { AiProvider } from "./settings";

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

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * True when the AI settings send content off the machine: Anthropic and OpenAI always do, and an
 * OpenAI-compatible endpoint does unless its host is loopback (Ollama, LM Studio on this computer).
 * An endpoint that cannot be parsed counts as cloud, so the consent note is shown.
 */
export function isCloudAiEndpoint(ai: { provider: AiProvider; baseUrl: string }): boolean {
  if (ai.provider !== "openai-compatible" || ai.baseUrl.trim() === "") {
    return true;
  }
  try {
    const host = new URL(ai.baseUrl.trim()).hostname;
    return !(LOCAL_HOSTNAMES.has(host) || host.endsWith(".localhost"));
  } catch {
    return true;
  }
}
