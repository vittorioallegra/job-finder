import { APICallError, RetryError } from "ai";

export const AI_ERROR_CODES = [
  "not-configured",
  "invalid-key",
  "model-not-found",
  "rate-limited",
  "unreachable",
  "timeout",
  "invalid-output",
  "unknown",
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

/** Every AI failure surfaces as this error, carrying a code the UI can explain. Never carries a key. */
export class AiError extends Error {
  readonly code: AiErrorCode;
  /**
   * A short technical hint for the settings screen, such as `HTTP 400 unsupported_value` or
   * `TimeoutError`: only a status and identifiers, never a key or a provider's error text.
   */
  readonly detail: string | null;

  constructor(code: AiErrorCode, message: string, detail: string | null = null) {
    super(message);
    this.name = "AiError";
    this.code = code;
    this.detail = detail;
  }
}

/** A provider's error identifier (`code`, `type` or `param`) is kept only when it looks like one. */
const IDENTIFIER = /^[A-Za-z0-9_.-]{1,64}$/;

function providerIdentifiers(data: unknown, responseBody: string | undefined): string[] {
  let parsed = data;
  if (parsed === undefined && responseBody) {
    try {
      parsed = JSON.parse(responseBody);
    } catch {
      parsed = undefined;
    }
  }
  const root =
    typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  const inner =
    typeof root.error === "object" && root.error !== null
      ? (root.error as Record<string, unknown>)
      : root;
  const found: string[] = [];
  for (const field of ["code", "type", "param", "status"]) {
    const value = inner[field];
    if (typeof value === "string" && IDENTIFIER.test(value) && !found.includes(value)) {
      found.push(value);
    }
  }
  return found;
}

function httpDetail(
  status: number | undefined,
  data: unknown,
  responseBody?: string,
): string | null {
  if (status === undefined) return null;
  return [`HTTP ${status}`, ...providerIdentifiers(data, responseBody)].join(" ");
}

/** Maps any thrown value from the AI SDK or a fetch call to an `AiError`. */
export function toAiError(error: unknown): AiError {
  if (error instanceof AiError) {
    return error;
  }
  if (RetryError.isInstance(error) && error.lastError !== undefined) {
    // The SDK retries 429 and 5xx answers, then wraps the last one; that one says what went wrong.
    return toAiError(error.lastError);
  }
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    const detail = httpDetail(status, error.data, error.responseBody);
    if (status === 401 || status === 403) {
      return new AiError("invalid-key", "The provider rejected the API key", detail);
    }
    if (status === 404) {
      return new AiError(
        "model-not-found",
        "The provider does not know this model or endpoint",
        detail,
      );
    }
    if (status === 429) {
      return new AiError("rate-limited", "The provider is rate limiting requests", detail);
    }
    if (status === undefined) {
      return new AiError("unreachable", "The provider could not be reached");
    }
    return new AiError("unknown", `The provider answered with HTTP ${status}`, detail);
  }
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return new AiError("timeout", "The provider did not answer in time");
  }
  if (error instanceof TypeError) {
    // The fetch implementation throws a TypeError when the connection fails.
    return new AiError("unreachable", "The provider could not be reached");
  }
  const name = error instanceof Error && IDENTIFIER.test(error.name) ? error.name : null;
  return new AiError("unknown", "The AI request failed", name);
}
