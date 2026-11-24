import {
  GEMINI_BASE_URL,
  OLLAMA_BASE_URL,
  aiSourceFor,
  isGeminiBaseUrl,
  type AiProvider,
} from "@job-finder/bridge";

/**
 * What the provider menu offers. Gemini and Ollama are not providers of their own in the
 * settings: each is the OpenAI-compatible provider at its known address, shown as a guided choice.
 */
export type AiChoice = AiProvider | "gemini" | "ollama";

export const AI_CHOICES: readonly AiChoice[] = [
  "anthropic",
  "openai",
  "gemini",
  "ollama",
  "openai-compatible",
];

/** The fields the provider choice controls. */
export interface AiChoiceFields {
  choice: AiChoice;
  model: string;
  baseUrl: string;
}

/** The menu entry for saved settings: Gemini or Ollama when the OpenAI-compatible URL is theirs. */
export function aiChoiceFromSettings(ai: { provider: AiProvider; baseUrl: string }): AiChoice {
  return aiSourceFor(ai);
}

/** The provider and base URL to save for a menu entry. Hosted providers keep no base URL. */
export function aiSettingsFromChoice(fields: AiChoiceFields): {
  provider: AiProvider;
  model: string;
  baseUrl: string;
} {
  if (fields.choice === "gemini") {
    // The address is fixed; the screen does not show it.
    const baseUrl = isGeminiBaseUrl(fields.baseUrl) ? fields.baseUrl : GEMINI_BASE_URL;
    return { provider: "openai-compatible", model: fields.model, baseUrl };
  }
  if (fields.choice === "ollama") {
    const baseUrl = fields.baseUrl.trim() === "" ? OLLAMA_BASE_URL : fields.baseUrl;
    return { provider: "openai-compatible", model: fields.model, baseUrl };
  }
  return {
    provider: fields.choice,
    model: fields.model,
    baseUrl: fields.choice === "openai-compatible" ? fields.baseUrl : "",
  };
}

/**
 * The fields after the user picks another menu entry. The model and the address always start
 * over, since neither carries from one provider to another; Gemini and Ollama get their address.
 */
export function switchAiChoice(fields: AiChoiceFields, choice: AiChoice): AiChoiceFields {
  if (choice === fields.choice) return fields;
  const baseUrl =
    choice === "gemini" ? GEMINI_BASE_URL : choice === "ollama" ? OLLAMA_BASE_URL : "";
  return { choice, model: "", baseUrl };
}

/**
 * Hosted providers (Anthropic, OpenAI, Gemini) read far more than any CV or posting; their context
 * size is set to this and not shown. Ollama and other servers read only what they were started
 * with, so the user sets it there.
 */
export const HOSTED_CONTEXT_SIZE = 128_000;

/**
 * The context size Ollama starts from. The longest request the app sends is a careers page
 * (up to 60,000 characters, about 15k tokens) plus the answer, so 32k fits every request.
 */
export const OLLAMA_CONTEXT_SIZE = 32_768;

/** The value the context size field starts from for another server: a common setup. */
export const LOCAL_CONTEXT_SIZE = 8192;

/** True when the user sets the context size: Ollama and other OpenAI-compatible servers. */
export function choiceSetsContextSize(choice: AiChoice): boolean {
  return choice === "ollama" || choice === "openai-compatible";
}

/** The context size a choice starts from when the user picks it. */
export function defaultContextSize(choice: AiChoice): number {
  if (choice === "ollama") return OLLAMA_CONTEXT_SIZE;
  if (choice === "openai-compatible") return LOCAL_CONTEXT_SIZE;
  return HOSTED_CONTEXT_SIZE;
}

/**
 * The context size to save for a choice. A server keeps the size chosen for it; a value left from
 * a hosted provider never carries over to one, since it would hide that texts are too long.
 */
export function contextSizeFor(choice: AiChoice, typed: number): number {
  if (!choiceSetsContextSize(choice)) return HOSTED_CONTEXT_SIZE;
  return typed === HOSTED_CONTEXT_SIZE ? defaultContextSize(choice) : typed;
}

/** Context sizes the Ollama slider stops at, in tokens, before it is cut at the model's limit. */
const CONTEXT_STEPS = [4096, 8192, 16_384, 32_768, 65_536, 131_072, 262_144, 524_288, 1_048_576];

/** Without a known model limit, the slider stops here. */
export const UNKNOWN_MODEL_CONTEXT = 131_072;

/** The slider's stops up to a model's limit; a limit between two stops is a stop of its own. */
export function contextSteps(modelLimit: number | null): number[] {
  const limit = modelLimit ?? UNKNOWN_MODEL_CONTEXT;
  const steps = CONTEXT_STEPS.filter((step) => step <= limit);
  if (steps.at(-1) !== limit) steps.push(limit);
  return steps;
}
