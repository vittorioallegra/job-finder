// protects=toAiError looks inside the SDK's retry wrapper, so a failure after retries keeps its own code and detail;
// fails_when=an exhausted retry of a 429 or 5xx answer is reported as an unexpected error named after the wrapper;
// no_claim=the SDK's retry timing and which statuses it retries are not checked.
import { APICallError, RetryError } from "ai";
import { describe, expect, it } from "vitest";
import { toAiError } from "./errors";

describe("toAiError", () => {
  it("explains the last answer after the SDK gave up retrying", () => {
    const lastError = new APICallError({
      message: "quota",
      url: "https://api.openai.com/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 429,
      responseBody: JSON.stringify({
        error: { type: "insufficient_quota", code: "insufficient_quota" },
      }),
    });
    const error = toAiError(
      new RetryError({
        message: "Failed after 3 attempts.",
        reason: "maxRetriesExceeded",
        errors: [lastError, lastError, lastError],
      }),
    );
    expect(error.code).toBe("rate-limited");
    expect(error.detail).toBe("HTTP 429 insufficient_quota");
  });
});
