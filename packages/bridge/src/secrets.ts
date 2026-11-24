import { z } from "zod";

/**
 * Every secret the app stores. Names are fixed here; the renderer never sends arbitrary keys. Each
 * AI provider has its own key, so a key saved for one never reaches another (`aiKeyNameFor`).
 */
export const SECRET_NAMES = [
  "ai.apiKey.anthropic",
  "ai.apiKey.openai",
  "ai.apiKey.gemini",
  "ai.apiKey.openai-compatible",
  "search.brave",
  "search.tavily",
  "search.serper",
] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

/** What the renderer may see about secrets: whether each key is set, never its value. */
export interface SecretsStatus {
  keys: Record<SecretName, boolean>;
}

export const SecretSetRequestSchema = z.strictObject({
  name: z.enum(SECRET_NAMES),
  value: z.string().trim().min(1).max(4096),
});

export const SecretClearRequestSchema = z.strictObject({
  name: z.enum(SECRET_NAMES),
});
