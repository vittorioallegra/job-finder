import type { AiTestResult } from "@job-finder/bridge";
import type { AiConnectionResult, AiProviderConfig } from "@job-finder/core/ai";
import { EngineUnavailableError } from "../engine/supervisor";
import type { SecretStore } from "../secrets/store";
import type { SettingsRepository } from "../settings/repository";

/** The engine side of a connection test, as seen from main. */
export interface AiEngine {
  testAiConnection(config: AiProviderConfig): Promise<AiConnectionResult>;
}

export interface AiConnectionServiceOptions {
  settings: SettingsRepository;
  secrets: SecretStore;
  engine: AiEngine;
}

export interface AiConnectionService {
  /** Tests the saved AI settings. The key is read here and handed only to the engine. */
  testConnection(): Promise<AiTestResult>;
}

/**
 * Main-process side of "test connection". Settings come from the settings repository and the key
 * from SecretStore; the engine performs the request. The result carries no key and no provider
 * error body, only a code.
 */
export function createAiConnectionService(
  options: AiConnectionServiceOptions,
): AiConnectionService {
  return {
    async testConnection() {
      const { ai } = await options.settings.get();
      const apiKey = await options.secrets.read("ai.apiKey");
      try {
        return await options.engine.testAiConnection({
          provider: ai.provider,
          model: ai.model,
          baseUrl: ai.baseUrl,
          apiKey,
        });
      } catch (error) {
        if (error instanceof EngineUnavailableError) {
          return { ok: false, code: "engine-unavailable" };
        }
        return { ok: false, code: "unknown" };
      }
    },
  };
}
