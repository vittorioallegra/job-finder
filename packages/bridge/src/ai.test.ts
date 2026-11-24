// protects=the AI test channel takes no payload and the failure code list matches the codes the AI layer and engine can produce, so the renderer can translate every outcome; the model list channel takes a source and an address but never a key, and Ollama is recognised only on a loopback host and its port, Gemini only on Google's API host; each provider maps to its own key and Ollama to none;
// fails_when=the channel accepts a payload that could carry a key, or a failure code the UI has no message for is added without an entry in this list;
// no_claim=the result type is not checked against the core error codes at runtime, only as a list here; renderer translations are checked in apps/web.
import { describe, expect, it } from "vitest";
import {
  AI_TEST_FAILURE_CODES,
  IPC_REQUEST_SCHEMAS,
  GEMINI_BASE_URL,
  OLLAMA_BASE_URL,
  aiConsentTarget,
  isCloudAiEndpoint,
  hasAiConsent,
  aiKeyNameFor,
  isGeminiBaseUrl,
  isOllamaBaseUrl,
} from "./index";

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

describe("local Ollama", () => {
  it("lists models for a known source and an address, never with a key in the payload", () => {
    const schema = IPC_REQUEST_SCHEMAS["ai:models"];
    expect(
      schema.safeParse({ source: "ollama", baseUrl: "http://localhost:11434/v1" }).success,
    ).toBe(true);
    expect(schema.safeParse({ source: "anthropic", baseUrl: "" }).success).toBe(true);
    expect(schema.safeParse({ source: "mistral", baseUrl: "" }).success).toBe(false);
    expect(schema.safeParse({ source: "openai", baseUrl: "", apiKey: "k" }).success).toBe(false);
  });

  it("recognises Ollama only on a loopback host and Ollama's port", () => {
    expect(isOllamaBaseUrl("http://localhost:11434/v1")).toBe(true);
    expect(isOllamaBaseUrl(" http://127.0.0.1:11434/v1 ")).toBe(true);
    expect(isOllamaBaseUrl("http://localhost:1234/v1")).toBe(false);
    expect(isOllamaBaseUrl("https://ollama.example.com:11434/v1")).toBe(false);
    expect(isOllamaBaseUrl("")).toBe(false);
  });
});

describe("Gemini", () => {
  it("is recognised only on Google's API host, and counts as cloud", () => {
    expect(isGeminiBaseUrl(GEMINI_BASE_URL)).toBe(true);
    expect(isGeminiBaseUrl("https://generativelanguage.googleapis.com.example.com/v1")).toBe(false);
    expect(isGeminiBaseUrl("not a url")).toBe(false);
    expect(isCloudAiEndpoint({ provider: "openai-compatible", baseUrl: GEMINI_BASE_URL })).toBe(
      true,
    );
  });
});

describe("AI keys per provider", () => {
  it("gives each provider its own key and Ollama none", () => {
    expect(aiKeyNameFor({ provider: "anthropic", baseUrl: "" })).toBe("ai.apiKey.anthropic");
    expect(aiKeyNameFor({ provider: "openai", baseUrl: "" })).toBe("ai.apiKey.openai");
    expect(aiKeyNameFor({ provider: "openai-compatible", baseUrl: GEMINI_BASE_URL })).toBe(
      "ai.apiKey.gemini",
    );
    expect(aiKeyNameFor({ provider: "openai-compatible", baseUrl: OLLAMA_BASE_URL })).toBeNull();
    expect(
      aiKeyNameFor({ provider: "openai-compatible", baseUrl: "https://llm.example.com/v1" }),
    ).toBe("ai.apiKey.openai-compatible");
  });
});
