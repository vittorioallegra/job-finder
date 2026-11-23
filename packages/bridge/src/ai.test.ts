// protects=the AI test channel takes no payload and the failure code list matches the codes the AI layer and engine can produce, so the renderer can translate every outcome;
// fails_when=the channel accepts a payload that could carry a key, or a failure code the UI has no message for is added without an entry in this list;
// no_claim=the result type is not checked against the core error codes at runtime, only as a list here; renderer translations are checked in apps/web.
import { describe, expect, it } from "vitest";
import { AI_TEST_FAILURE_CODES, IPC_REQUEST_SCHEMAS } from "./index";

describe("AI connection test contract", () => {
  it("takes no payload, so the renderer cannot send a key through it", () => {
    expect(IPC_REQUEST_SCHEMAS["ai:test-connection"].safeParse(undefined).success).toBe(true);
    expect(IPC_REQUEST_SCHEMAS["ai:test-connection"].safeParse({ apiKey: "sk-test" }).success).toBe(
      false,
    );
  });

  it("lists every failure code the settings screen must explain", () => {
    expect([...AI_TEST_FAILURE_CODES].sort()).toEqual(
      [
        "engine-unavailable",
        "invalid-key",
        "invalid-output",
        "model-not-found",
        "not-configured",
        "rate-limited",
        "unknown",
        "unreachable",
      ].sort(),
    );
  });
});
