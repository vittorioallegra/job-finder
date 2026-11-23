// protects=the connection test reads the saved AI settings and the key in main, hands the key only to the engine, and returns a code (never the key) for every outcome including an unreachable engine;
// fails_when=the key is returned or logged in the result, the wrong provider or model is sent, or an unreachable engine is reported as a generic failure;
// no_claim=the provider request itself and the keychain are not exercised; the engine round trip is covered by the supervisor test.
import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "@job-finder/bridge";
import type { AiConnectionResult, AiProviderConfig } from "@job-finder/core/ai";
import { EngineUnavailableError } from "../engine/supervisor";
import type { SecretStore } from "../secrets/store";
import type { SettingsRepository } from "../settings/repository";
import { createAiConnectionService } from "./connection";

const KEY = "sk-live-test-key";

function settingsWith(ai: Partial<AppSettings["ai"]>): SettingsRepository {
  const settings: AppSettings = {
    ...DEFAULT_APP_SETTINGS,
    ai: { ...DEFAULT_APP_SETTINGS.ai, ...ai },
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
        baseUrl: "http://localhost:11434/v1",
      }),
      secrets: secretsReturning(KEY),
      engine: {
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
        baseUrl: "http://localhost:11434/v1",
        apiKey: KEY,
      },
    ]);
    expect(result).toEqual({ ok: true, model: "llama" });
  });

  it("returns the engine's failure code without the key", async () => {
    const outcome: AiConnectionResult = { ok: false, code: "invalid-key" };
    const service = createAiConnectionService({
      settings: settingsWith({}),
      secrets: secretsReturning(KEY),
      engine: { testAiConnection: async () => outcome },
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
        testAiConnection: async (config) => {
          seen.push(config.apiKey);
          throw new Error("unexpected");
        },
      },
    });

    await expect(service.testConnection()).resolves.toEqual({ ok: false, code: "unknown" });
    expect(seen).toEqual([null]);
  });
});
