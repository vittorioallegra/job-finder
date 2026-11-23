/** Provider kinds the AI layer can talk to. Mirrors `AI_PROVIDERS` in packages/bridge. */
export const AI_PROVIDER_KINDS = ["anthropic", "openai", "openai-compatible"] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

export interface AiCapabilities {
  /**
   * `true`: the provider's native structured output (schema-constrained decoding) is used.
   * `false`: the layer asks for JSON in plain text, then parses and validates it (JSON-mode fallback).
   */
  nativeStructuredOutput: boolean;
}

/** Local OpenAI-compatible servers (Ollama, LM Studio) are not guaranteed to honour a schema. */
export const AI_CAPABILITIES: Record<AiProviderKind, AiCapabilities> = {
  anthropic: { nativeStructuredOutput: true },
  openai: { nativeStructuredOutput: true },
  "openai-compatible": { nativeStructuredOutput: false },
};
