// protects=each AI provider reads its own key, Ollama reads none, and the single key of earlier versions moves once to the provider saved at the time;
// fails_when=one provider's key is read for another, Ollama gets a key, the old key is lost under a keyed provider, kept under Ollama, or overwrites a key already saved;
// no_claim=the keychain encryption is not exercised; the rows hold opaque strings.
import { describe, expect, it } from "vitest";
import type { SecretName } from "@job-finder/bridge";
import type { SecretRows } from "../secrets/store";
import { migrateLegacyAiKey, readAiKey } from "./keys";

function memoryRows(initial: Record<string, string>): SecretRows & { all: Map<string, string> } {
  const all = new Map(Object.entries(initial));
  return {
    all,
    read: async (key) => all.get(key) ?? null,
    write: async (key, value) => {
      all.set(key, value);
    },
    remove: async (key) => {
      all.delete(key);
    },
  };
}

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

  it("moves the old shared key to the saved provider's key", async () => {
    const rows = memoryRows({ "secret.ai.apiKey": "cipher" });
    await migrateLegacyAiKey(rows, { provider: "openai", baseUrl: "" });
    expect(Object.fromEntries(rows.all)).toEqual({ "secret.ai.apiKey.openai": "cipher" });
    await migrateLegacyAiKey(rows, { provider: "anthropic", baseUrl: "" });
    expect(Object.fromEntries(rows.all)).toEqual({ "secret.ai.apiKey.openai": "cipher" });
  });

  it("drops the old key under Ollama and never overwrites a key already saved", async () => {
    const underOllama = memoryRows({ "secret.ai.apiKey": "cipher" });
    await migrateLegacyAiKey(underOllama, {
      provider: "openai-compatible",
      baseUrl: "http://localhost:11434/v1",
    });
    expect(underOllama.all.size).toBe(0);

    const alreadySet = memoryRows({
      "secret.ai.apiKey": "old",
      "secret.ai.apiKey.openai": "new",
    });
    await migrateLegacyAiKey(alreadySet, { provider: "openai", baseUrl: "" });
    expect(Object.fromEntries(alreadySet.all)).toEqual({ "secret.ai.apiKey.openai": "new" });
  });
});
