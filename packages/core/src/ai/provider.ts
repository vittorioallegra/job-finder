import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { AI_CAPABILITIES, type AiCapabilities, type AiProviderKind } from "./capabilities";
import { AiError } from "./errors";

export interface AiProviderConfig {
  provider: AiProviderKind;
  model: string;
  /** Empty means the provider's default endpoint. Required for `openai-compatible`. */
  baseUrl: string;
  /** Null for keyless local servers. Never logged, never sent to the renderer. */
  apiKey: string | null;
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
