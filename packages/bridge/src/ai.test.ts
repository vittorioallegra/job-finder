// protects=the AI test channel takes no payload and the failure code list matches the codes the AI layer and engine can produce, so the renderer can translate every outcome;
// fails_when=the channel accepts a payload that could carry a key, or a failure code the UI has no message for is added without an entry in this list;
// no_claim=the result type is not checked against the core error codes at runtime, only as a list here; renderer translations are checked in apps/web.
import { describe, expect, it } from "vitest";
import { AI_TEST_FAILURE_CODES, IPC_REQUEST_SCHEMAS, aiConsentTarget, hasAiConsent } from "./index";

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

describe("consent target", () => {
  // A consent counts only for the provider and OpenAI-compatible origin it was given for;
  // a consent that survives a provider or host change fails these checks.
  it("binds consent to the provider and, for OpenAI-compatible, the origin", () => {
    const hosted = { provider: "anthropic" as const, baseUrl: "" };
    const remote = {
      provider: "openai-compatible" as const,
      baseUrl: "https://llm.example.com/v1",
    };
    const local = { provider: "openai-compatible" as const, baseUrl: "http://localhost:11434/v1" };

    expect(hasAiConsent(hosted, { consent: true, consentTarget: aiConsentTarget(hosted) })).toBe(
      true,
    );
    expect(hasAiConsent(hosted, { consent: true })).toBe(false);
    expect(hasAiConsent(hosted, { consent: true, consentTarget: aiConsentTarget(remote) })).toBe(
      false,
    );
    expect(hasAiConsent(remote, { consent: true, consentTarget: aiConsentTarget(remote) })).toBe(
      true,
    );
    expect(
      hasAiConsent(
        { ...remote, baseUrl: "https://other.example.com/v1" },
        { consent: true, consentTarget: aiConsentTarget(remote) },
      ),
    ).toBe(false);
    expect(hasAiConsent(local, {})).toBe(true);
  });
});
