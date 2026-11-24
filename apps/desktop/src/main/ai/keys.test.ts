// protects=each AI provider reads its own key and Ollama reads none;
// fails_when=one provider's key is read for another, or Ollama gets a key;
// no_claim=how keys are stored is the secret store's concern, tested on its own.
import { describe, expect, it } from "vitest";
import type { SecretName } from "@job-finder/bridge";
import { readAiKey } from "./keys";

describe("AI keys", () => {
  it("reads the saved provider's own key, and none for Ollama", async () => {
    const asked: SecretName[] = [];
    const secrets = {
      read: async (name: SecretName) => {
        asked.push(name);
        return `value-of-${name}`;
      },
    };
    await expect(readAiKey(secrets, { provider: "anthropic", baseUrl: "" })).resolves.toBe(
      "value-of-ai.apiKey.anthropic",
    );
    await expect(
      readAiKey(secrets, {
        provider: "openai-compatible",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      }),
    ).resolves.toBe("value-of-ai.apiKey.gemini");
    await expect(
      readAiKey(secrets, { provider: "openai-compatible", baseUrl: "http://localhost:11434/v1" }),
    ).resolves.toBeNull();
    expect(asked).toEqual(["ai.apiKey.anthropic", "ai.apiKey.gemini"]);
  });
});
