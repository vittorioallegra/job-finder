import { APICallError } from "ai";

export const AI_ERROR_CODES = [
  "not-configured",
  "invalid-key",
  "model-not-found",
  "rate-limited",
  "unreachable",
  "invalid-output",
  "unknown",
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

/** Every AI failure surfaces as this error, carrying a code the UI can explain. Never carries a key. */
export class AiError extends Error {
  readonly code: AiErrorCode;

  constructor(code: AiErrorCode, message: string) {
    super(message);
    this.name = "AiError";
    this.code = code;
  }
}

/** Maps any thrown value from the AI SDK or a fetch call to an `AiError`. */
export function toAiError(error: unknown): AiError {
  if (error instanceof AiError) {
    return error;
  }
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    if (status === 401 || status === 403) {
      return new AiError("invalid-key", "The provider rejected the API key");
    }
    if (status === 404) {
      return new AiError("model-not-found", "The provider does not know this model or endpoint");
    }
    if (status === 429) {
      return new AiError("rate-limited", "The provider is rate limiting requests");
    }
    if (status === undefined) {
      return new AiError("unreachable", "The provider could not be reached");
    }
    return new AiError("unknown", `The provider answered with HTTP ${status}`);
  }
  if (error instanceof TypeError) {
    // The fetch implementation throws a TypeError when the connection fails.
    return new AiError("unreachable", "The provider could not be reached");
  }
  return new AiError("unknown", "The AI request failed");
}
