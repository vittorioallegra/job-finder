import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defaultSettingsMiddleware, wrapLanguageModel, type LanguageModel } from "ai";
import { createOllama } from "ollama-ai-provider-v2";
import { AI_CAPABILITIES, type AiCapabilities, type AiProviderKind } from "./capabilities";
import { AiError } from "./errors";

export interface AiProviderConfig {
  provider: AiProviderKind;
  model: string;
  /** Empty means the provider's default endpoint. Required for `openai-compatible`. */
  baseUrl: string;
  /** Null for keyless local servers. Never logged, never sent to the renderer. */
  apiKey: string | null;
  /**
   * The context size the user chose. Only Ollama takes it per request (as `num_ctx`); hosted
   * providers and other servers read what they were set up with.
   */
  contextSize?: number;
}

const OLLAMA_PORT = "11434";

/** Ollama through its native API honours a JSON schema, unlike most OpenAI-compatible servers. */
const OLLAMA_CAPABILITIES: AiCapabilities = { nativeStructuredOutput: true };
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** True when an OpenAI-compatible server runs on this computer (a loopback host). */
export function isLocalAiEndpoint(config: Pick<AiProviderConfig, "provider" | "baseUrl">): boolean {
  if (config.provider !== "openai-compatible") return false;
  try {
    const host = new URL(config.baseUrl.trim()).hostname;
    return LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

/**
 * True when an OpenAI-compatible base URL is Ollama on this computer: a loopback host on Ollama's
 * port. Mirrors `isOllamaBaseUrl` in packages/bridge, which this package cannot import.
 */
export function isOllamaEndpoint(baseUrl: string): boolean {
  try {
    return (
      isLocalAiEndpoint({ provider: "openai-compatible", baseUrl }) &&
      new URL(baseUrl.trim()).port === OLLAMA_PORT
    );
  } catch {
    return false;
  }
}

export interface AiModelHandle {
  model: LanguageModel;
  capabilities: AiCapabilities;
}

export interface AiProviderOptions {
  /** Replaces the global fetch; tests pass the record/replay fetch here. */
  fetch?: typeof fetch;
}

/** Builds the language model for the configured provider. Throws `AiError("not-configured")` when a required setting is missing. */
export function createAiModel(
  config: AiProviderConfig,
  options: AiProviderOptions = {},
): AiModelHandle {
  const modelId = config.model.trim();
  if (modelId === "") {
    throw new AiError("not-configured", "No AI model is configured");
  }
  // Only the OpenAI-compatible provider has a user-chosen endpoint. A base URL left over from an
  // earlier setup must never redirect a hosted provider's API key and prompts to another host.
  const trimmedUrl = config.baseUrl.trim();
  const baseURL =
    config.provider === "openai-compatible" && trimmedUrl !== "" ? trimmedUrl : undefined;
  const apiKey = config.apiKey?.trim() ? config.apiKey.trim() : undefined;
  const fetchImpl = options.fetch;

  switch (config.provider) {
    case "anthropic": {
      if (apiKey === undefined) {
        throw new AiError("not-configured", "No API key is set for the AI provider");
      }
      const provider = createAnthropic({ apiKey, baseURL, fetch: fetchImpl });
      return { model: provider(modelId), capabilities: AI_CAPABILITIES.anthropic };
    }
    case "openai": {
      if (apiKey === undefined) {
        throw new AiError("not-configured", "No API key is set for the AI provider");
      }
      const provider = createOpenAI({ apiKey, baseURL, fetch: fetchImpl });
      // Chat Completions rather than Responses: the same wire format as OpenAI-compatible servers.
      return { model: provider.chat(modelId), capabilities: AI_CAPABILITIES.openai };
    }
    case "openai-compatible": {
      if (baseURL === undefined) {
        throw new AiError("not-configured", "The OpenAI-compatible provider needs a base URL");
      }
      if (isOllamaEndpoint(baseURL)) {
        // Ollama's native API constrains the answer to the JSON schema (`format`), so the model
        // cannot answer with fields of its own the way plain JSON mode lets it.
        return {
          model: ollamaModel(baseURL, modelId, config.contextSize, fetchImpl),
          capabilities: OLLAMA_CAPABILITIES,
        };
      }
      const provider = createOpenAICompatible({
        name: "openai-compatible",
        baseURL,
        apiKey,
        fetch: fetchImpl,
      });
      return {
        model: provider.chatModel(modelId),
        capabilities: AI_CAPABILITIES["openai-compatible"],
      };
    }
  }
}

/**
 * Ollama through its own API rather than its OpenAI-compatible one: only the native API takes the
 * context size per request, so the app's choice holds whatever Ollama was started with.
 */
function ollamaModel(
  baseURL: string,
  modelId: string,
  contextSize: number | undefined,
  fetchImpl: typeof fetch | undefined,
): LanguageModel {
  const provider = createOllama({
    baseURL: new URL("/api", new URL(baseURL).origin).toString(),
    fetch: fetchImpl,
  });
  const model = provider(modelId);
  if (contextSize === undefined) return model;
  return wrapLanguageModel({
    model,
    middleware: defaultSettingsMiddleware({
      settings: { providerOptions: { ollama: { options: { num_ctx: contextSize } } } },
    }),
  });
}
