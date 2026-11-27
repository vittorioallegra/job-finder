// protects=the connection test reads the saved AI settings and the key in main, hands the key only to the engine, and returns a code (never the key) for every outcome including an unreachable engine; each provider gets only its own key (Ollama none), and the model list sends the OpenAI-compatible key only to the saved server and asks Ollama only on loopback;
// fails_when=a connection is tested with the AI off, the key is returned or logged in the result, the wrong provider or model is sent, an unreachable engine is reported as a generic failure, or the key reaches another address through the model list;
// no_claim=the provider request itself and the keychain are not exercised; the engine round trip is covered by the supervisor test.
import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS, type AppSettings, type SecretName } from "@job-finder/bridge";
import type {
  AiConnectionResult,
  AiModelsOutcome,
  AiModelsRequest,
  AiProviderConfig,
} from "@job-finder/core/ai";
import { EngineUnavailableError } from "../engine/supervisor";
import type { SecretStore } from "../secrets/store";
import type { SettingsRepository } from "../settings/repository";
import { createAiConnectionService } from "./connection";

const KEY = "sk-live-test-key";

const noModels = async (): Promise<AiModelsOutcome> => ({
  ok: false,
  code: "unreachable",
});

function settingsWith(ai: Partial<AppSettings["ai"]>): SettingsRepository {
  const settings: AppSettings = {
    ...DEFAULT_APP_SETTINGS,
    ai: { ...DEFAULT_APP_SETTINGS.ai, enabled: true, ...ai },
  };
  return {
    get: async () => settings,
    update: async () => settings,
  };
}

function secretsReturning(value: string | null): SecretStore {
  return { read: async () => value } as unknown as SecretStore;
}

describe("AI connection service", () => {
  it("sends the saved provider, model, base URL and key to the engine, and returns its result", async () => {
    const seen: AiProviderConfig[] = [];
    const service = createAiConnectionService({
      settings: settingsWith({
        provider: "openai-compatible",
        model: "llama",
        baseUrl: "http://localhost:1234/v1",
      }),
      secrets: secretsReturning(KEY),
      engine: {
        listModels: noModels,
        testAiConnection: async (config) => {
          seen.push(config);
          return { ok: true, model: config.model };
        },
      },
    });

    const result = await service.testConnection();

    expect(seen).toEqual([
      {
        provider: "openai-compatible",
        model: "llama",
        baseUrl: "http://localhost:1234/v1",
        apiKey: KEY,
        contextSize: 8192,
      },
    ]);
    expect(result).toEqual({ ok: true, model: "llama" });
  });

  it("returns the engine's failure code without the key", async () => {
    const outcome: AiConnectionResult = { ok: false, code: "invalid-key" };
    const service = createAiConnectionService({
      settings: settingsWith({}),
      secrets: secretsReturning(KEY),
      engine: { testAiConnection: async () => outcome, listModels: noModels },
    });

    const result = await service.testConnection();

    expect(result).toEqual({ ok: false, code: "invalid-key" });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("reports engine-unavailable when the engine cannot answer", async () => {
    const service = createAiConnectionService({
      settings: settingsWith({}),
      secrets: secretsReturning(KEY),
      engine: {
        listModels: noModels,
        testAiConnection: async () => {
          throw new EngineUnavailableError("gave_up");
        },
      },
    });

    await expect(service.testConnection()).resolves.toEqual({
      ok: false,
      code: "engine-unavailable",
    });
  });

  it("reports unknown for any other failure, and sends no key when none is stored", async () => {
    const seen: Array<string | null> = [];
    const service = createAiConnectionService({
      settings: settingsWith({}),
      secrets: secretsReturning(null),
      engine: {
        listModels: noModels,
        testAiConnection: async (config) => {
          seen.push(config.apiKey);
          throw new Error("unexpected");
        },
      },
    });

    await expect(service.testConnection()).resolves.toEqual({
      ok: false,
      code: "unknown",
      detail: "Error",
    });
    expect(seen).toEqual([null]);
  });

  it("sends each provider only its own key, and the OpenAI-compatible key only to the saved server", async () => {
    const asked: AiModelsRequest[] = [];
    const keys: Partial<Record<SecretName, string>> = {
      "ai.apiKey.anthropic": "sk-ant",
      "ai.apiKey.gemini": "gemini-key",
      "ai.apiKey.openai-compatible": "server-key",
    };
    const service = createAiConnectionService({
      settings: settingsWith({
        provider: "openai-compatible",
        baseUrl: "https://llm.example.com/v1",
      }),
      secrets: { read: async (name: SecretName) => keys[name] ?? null } as unknown as SecretStore,
      engine: {
        testAiConnection: async () => ({ ok: true, model: "unused" }),
        listModels: async (request) => {
          asked.push(request);
          return { ok: true, models: [] };
        },
      },
    });

    await service.listModels({ source: "anthropic", baseUrl: "" });
    await service.listModels({ source: "gemini", baseUrl: "https://elsewhere.example.com/" });
    await service.listModels({
      source: "openai-compatible",
      baseUrl: "https://llm.example.com/v1/",
    });
    await service.listModels({
      source: "openai-compatible",
      baseUrl: "https://other.example.com/v1",
    });
    await service.listModels({ source: "ollama", baseUrl: " http://localhost:11434/v1 " });
    await expect(service.listModels({ source: "openai", baseUrl: "" })).resolves.toEqual({
      ok: false,
      code: "no-key",
    });

    expect(asked).toEqual([
      { source: "anthropic", baseUrl: "", apiKey: "sk-ant" },
      {
        source: "gemini",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
        apiKey: "gemini-key",
      },
      { source: "openai-compatible", baseUrl: "https://llm.example.com/v1/", apiKey: "server-key" },
      { source: "openai-compatible", baseUrl: "https://other.example.com/v1", apiKey: null },
      { source: "ollama", baseUrl: "http://localhost:11434/v1", apiKey: null },
    ]);
  });

  it("tests the saved provider with its own key, and Ollama with none", async () => {
    const seen: Array<string | null> = [];
    const read = async (name: SecretName) => (name === "ai.apiKey.gemini" ? "gemini-key" : "other");
    for (const baseUrl of [
      "https://generativelanguage.googleapis.com/v1beta/openai/",
      "http://localhost:11434/v1",
    ]) {
      const service = createAiConnectionService({
        settings: settingsWith({ provider: "openai-compatible", model: "m", baseUrl }),
        secrets: { read } as unknown as SecretStore,
        engine: {
          listModels: noModels,
          testAiConnection: async (config) => {
            seen.push(config.apiKey);
            return { ok: true, model: "m" };
          },
        },
      });
      await service.testConnection();
    }
    expect(seen).toEqual(["gemini-key", null]);
  });

  it("asks nothing without a key or for a remote Ollama, and reports a missing engine", async () => {
    let asked = 0;
    const withoutKey = createAiConnectionService({
      settings: settingsWith({}),
      secrets: secretsReturning(null),
      engine: {
        testAiConnection: async () => ({ ok: true, model: "unused" }),
        listModels: async () => {
          asked += 1;
          throw new EngineUnavailableError("crashed");
        },
      },
    });
    await expect(withoutKey.listModels({ source: "openai", baseUrl: "" })).resolves.toEqual({
      ok: false,
      code: "no-key",
    });
    await expect(
      withoutKey.listModels({ source: "ollama", baseUrl: "https://ollama.example.com/v1" }),
    ).resolves.toEqual({ ok: false, code: "not-local" });
    expect(asked).toBe(0);
    await expect(
      withoutKey.listModels({ source: "ollama", baseUrl: "http://127.0.0.1:11434/v1" }),
    ).resolves.toEqual({ ok: false, code: "engine-unavailable" });
  });

  it("does not test a connection with the AI off", async () => {
    let asked = 0;
    const service = createAiConnectionService({
      settings: settingsWith({ enabled: false, provider: "anthropic", model: "claude-test" }),
      secrets: secretsReturning(KEY),
      engine: {
        listModels: noModels,
        testAiConnection: async () => {
          asked += 1;
          return { ok: true, model: "x" };
        },
      },
    });

    expect(await service.testConnection()).toEqual({ ok: false, code: "not-configured" });
    expect(asked).toBe(0);
  });
});
