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

/**
 * What a cloud consent is given for: the hosted provider, or the OpenAI-compatible provider at one
 * origin. Changing either asks again. The path of the URL does not matter, only where the data goes.
 */
export function aiConsentTarget(ai: { provider: AiProvider; baseUrl: string }): string {
  if (ai.provider !== "openai-compatible") return ai.provider;
  try {
    return `openai-compatible:${new URL(ai.baseUrl.trim()).origin}`;
  } catch {
    return `openai-compatible:${ai.baseUrl.trim()}`;
  }
}

/** True when nothing leaves the machine, or the user agreed for this provider and host. */
export function hasAiConsent(
  ai: { provider: AiProvider; baseUrl: string },
  request: { consent?: boolean | undefined; consentTarget?: string | undefined },
): boolean {
  if (!isCloudAiEndpoint(ai)) return true;
  return request.consent === true && request.consentTarget === aiConsentTarget(ai);
}

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

/** Ollama's OpenAI-compatible endpoint on this computer, its default address. */
export const OLLAMA_BASE_URL = "http://localhost:11434/v1";

const OLLAMA_PORT = "11434";

/**
 * True when an OpenAI-compatible base URL points at Ollama on this computer: a loopback host on
 * Ollama's port. The settings screen then shows the guided Ollama choice instead of the generic one.
 */
export function isOllamaBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl.trim());
    return (
      !isCloudAiEndpoint({ provider: "openai-compatible", baseUrl }) && url.port === OLLAMA_PORT
    );
  } catch {
    return false;
  }
}

/** Google Gemini's OpenAI-compatible endpoint. */
export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

const GEMINI_HOST = "generativelanguage.googleapis.com";

/**
 * True when an OpenAI-compatible base URL points at Google Gemini. The settings screen then shows
 * the guided Gemini choice instead of the generic one.
 */
export function isGeminiBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl.trim()).hostname === GEMINI_HOST;
  } catch {
    return false;
  }
}

/**
 * Where the model menu reads its list from. Mirrors `AI_MODEL_SOURCES` in core/ai, which the
 * bridge cannot import at runtime.
 */
export const AI_MODEL_SOURCES = [
  "anthropic",
  "openai",
  "gemini",
  "ollama",
  "openai-compatible",
] as const;
export type AiModelSource = (typeof AI_MODEL_SOURCES)[number];

/** Why the model list could not be read. */
export const AI_MODELS_FAILURE_CODES = [
  "no-key",
  "not-local",
  "invalid-key",
  "unreachable",
  "invalid-response",
  "engine-unavailable",
] as const;
export type AiModelsFailureCode = (typeof AI_MODELS_FAILURE_CODES)[number];

/** One entry of the model menu. */
export interface AiModelOption {
  id: string;
  label: string | null;
  sizeBytes: number | null;
}

/** The models a provider offers, or a code. Never carries the key. */
export type AiModelsResult =
  { ok: true; models: AiModelOption[] } | { ok: false; code: AiModelsFailureCode };
