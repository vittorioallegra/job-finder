import {
  GEMINI_BASE_URL,
  aiKeyNameForSource,
  aiSourceFor,
  isCloudAiEndpoint,
  type AiModelSource,
  type AiModelsResult,
  type AiTestResult,
} from "@job-finder/bridge";
import type {
  AiConnectionResult,
  AiModelsOutcome,
  AiModelsRequest,
  AiProviderConfig,
} from "@job-finder/core/ai";
import { EngineUnavailableError } from "../engine/supervisor";
import type { SecretStore } from "../secrets/store";
import type { SettingsRepository } from "../settings/repository";
import { readAiKey } from "./keys";

/** The engine side of a connection test, as seen from main. */
export interface AiEngine {
  testAiConnection(config: AiProviderConfig): Promise<AiConnectionResult>;
  listModels(request: AiModelsRequest): Promise<AiModelsOutcome>;
}

export interface AiConnectionServiceOptions {
  settings: SettingsRepository;
  secrets: SecretStore;
  engine: AiEngine;
}

export interface AiConnectionService {
  /** Tests the saved AI settings. The key is read here and handed only to the engine. */
  testConnection(): Promise<AiTestResult>;
  /**
   * The models a provider offers. Each provider gets only its own key: Anthropic, OpenAI and
   * Gemini at their fixed addresses, the OpenAI-compatible key only at the saved server's origin.
   * Ollama is asked only on a loopback host, with no key.
   */
  listModels(request: { source: AiModelSource; baseUrl: string }): Promise<AiModelsResult>;
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
      const apiKey = await readAiKey(options.secrets, ai);
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
        // Only the error's class name: its message could quote a provider response.
        const name = error instanceof Error ? error.name : "";
        return /^[A-Za-z0-9_.-]{1,64}$/.test(name)
          ? { ok: false, code: "unknown", detail: name }
          : { ok: false, code: "unknown" };
      }
    },
    async listModels({ source, baseUrl }) {
      let url = baseUrl.trim();
      let apiKey: string | null = null;
      if (source === "ollama") {
        if (isCloudAiEndpoint({ provider: "openai-compatible", baseUrl: url })) {
          return { ok: false, code: "not-local" };
        }
      } else if (source === "openai-compatible") {
        if (url === "") return { ok: false, code: "unreachable" };
        // A key typed for one server never goes to another address typed later.
        const { ai } = await options.settings.get();
        if (aiSourceFor(ai) === "openai-compatible" && sameOrigin(ai.baseUrl, url)) {
          apiKey = await options.secrets.read("ai.apiKey.openai-compatible");
        }
      } else {
        if (source === "gemini") url = GEMINI_BASE_URL;
        // Each hosted provider has its own key: the one in the menu, not the one in the settings.
        const name = aiKeyNameForSource(source);
        apiKey = name === null ? null : await options.secrets.read(name);
        if (apiKey === null || apiKey === "") return { ok: false, code: "no-key" };
      }
      try {
        return await options.engine.listModels({ source, baseUrl: url, apiKey });
      } catch (error) {
        if (error instanceof EngineUnavailableError) {
          return { ok: false, code: "engine-unavailable" };
        }
        return { ok: false, code: "unreachable" };
      }
    },
  };
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a.trim()).origin === new URL(b.trim()).origin;
  } catch {
    return false;
  }
}
