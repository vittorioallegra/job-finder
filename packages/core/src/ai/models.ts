/** Where a model list comes from: a hosted provider, Gemini, Ollama, or any OpenAI-compatible server. */
export const AI_MODEL_SOURCES = [
  "anthropic",
  "openai",
  "gemini",
  "ollama",
  "openai-compatible",
] as const;
export type AiModelSource = (typeof AI_MODEL_SOURCES)[number];

/** One model the provider offers. */
export interface AiModelInfo {
  /** The value to save as the model. */
  id: string;
  /** A friendlier name when the provider gives one. */
  label: string | null;
  /** Size on disk in bytes (Ollama only), or null. */
  sizeBytes: number | null;
  /** The longest context the model takes, in tokens (Ollama only), or null when unknown. */
  contextLength: number | null;
}

/** The models, or why they could not be read. Never carries the key or the response body. */
export type AiModelsOutcome =
  | { ok: true; models: AiModelInfo[] }
  | { ok: false; code: "invalid-key" | "unreachable" | "invalid-response" };

export interface AiModelsRequest {
  source: AiModelSource;
  /** The OpenAI-compatible base URL (Gemini, Ollama, others); ignored for Anthropic and OpenAI. */
  baseUrl: string;
  apiKey: string | null;
}

export interface AiModelsOptions {
  /** The same fetch the AI calls use; tests inject a scripted one. */
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models?limit=1000";
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const ANTHROPIC_VERSION = "2023-06-01";

/** OpenAI lists every model it has; these are not chat models and cannot answer the app. */
const NON_CHAT_PATTERN =
  /embedding|tts|whisper|dall-e|davinci|babbage|moderation|audio|realtime|transcribe|image|search|computer-use|sora|imagen|aqa|veo/i;

/**
 * Lists the models a provider offers, for the settings screen's model menu. Like the AI calls, this
 * talks to the provider directly, not through the crawler's HTTP client: robots.txt and the
 * per-host queue are for web pages. The caller decides which key may go to which address.
 */
export async function listAiModels(
  request: AiModelsRequest,
  options: AiModelsOptions = {},
): Promise<AiModelsOutcome> {
  const url = modelsUrl(request);
  if (url === null) return { ok: false, code: "unreachable" };

  const headers: Record<string, string> = { accept: "application/json" };
  if (request.source === "anthropic") {
    if (request.apiKey) headers["x-api-key"] = request.apiKey;
    headers["anthropic-version"] = ANTHROPIC_VERSION;
  } else if (request.apiKey && request.source !== "ollama") {
    headers.authorization = `Bearer ${request.apiKey}`;
  }

  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(url, { headers, signal: options.signal });
  } catch {
    return { ok: false, code: "unreachable" };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, code: "invalid-key" };
  }
  if (!response.ok) {
    // A server without this endpoint (another app on Ollama's port, a proxy) answers 404.
    return { ok: false, code: response.status === 404 ? "invalid-response" : "unreachable" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: "invalid-response" };
  }
  const models =
    request.source === "ollama" ? parseOllamaTags(body) : parseModelList(body, request.source);
  if (models === null) return { ok: false, code: "invalid-response" };
  if (request.source === "ollama") {
    await addOllamaContextLengths(url, models, options);
  }
  return { ok: true, models };
}

/**
 * Asks Ollama for each model's longest context (`/api/show`), so the settings can offer up to it.
 * A model Ollama cannot describe keeps null; the list itself still counts as read.
 */
async function addOllamaContextLengths(
  tagsUrl: string,
  models: AiModelInfo[],
  options: AiModelsOptions,
): Promise<void> {
  const showUrl = new URL("/api/show", new URL(tagsUrl).origin).toString();
  await Promise.all(
    models.map(async (model) => {
      try {
        const response = await (options.fetch ?? fetch)(showUrl, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ model: model.id }),
          signal: options.signal,
        });
        if (!response.ok) return;
        const info = record(record(await response.json())?.model_info);
        if (!info) return;
        // The key is `<architecture>.context_length`, such as `gemma4.context_length`.
        for (const [key, value] of Object.entries(info)) {
          if (key.endsWith(".context_length") && typeof value === "number" && value > 0) {
            model.contextLength = value;
            return;
          }
        }
      } catch {
        // Unknown length: the settings fall back to their own ceiling.
      }
    }),
  );
}

function modelsUrl(request: AiModelsRequest): string | null {
  if (request.source === "anthropic") return ANTHROPIC_MODELS_URL;
  if (request.source === "openai") return OPENAI_MODELS_URL;
  try {
    const base = new URL(request.baseUrl.trim());
    if (request.source === "ollama") {
      // Ollama's native list carries sizes; it lives at the server root, not under /v1.
      return new URL("/api/tags", base.origin).toString();
    }
    return `${base.toString().replace(/\/+$/, "")}/models`;
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function parseOllamaTags(body: unknown): AiModelInfo[] | null {
  const entries = record(body)?.models;
  if (!Array.isArray(entries)) return null;
  const models: AiModelInfo[] = [];
  for (const entry of entries) {
    const item = record(entry);
    if (!item) continue;
    const id = typeof item.name === "string" && item.name !== "" ? item.name : item.model;
    if (typeof id !== "string" || id === "") continue;
    const size = item.size;
    models.push({
      id,
      label: null,
      sizeBytes: typeof size === "number" && Number.isFinite(size) ? size : null,
      contextLength: null,
    });
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

/** The `{ data: [{ id }] }` list Anthropic, OpenAI and OpenAI-compatible servers answer. */
function parseModelList(body: unknown, source: AiModelSource): AiModelInfo[] | null {
  const entries = record(body)?.data;
  if (!Array.isArray(entries)) return null;
  const models: { info: AiModelInfo; created: number }[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const item = record(entry);
    if (!item || typeof item.id !== "string" || item.id === "") continue;
    // Gemini answers `models/gemini-…`; its chat endpoint takes the bare name.
    const id = source === "gemini" ? item.id.replace(/^models\//, "") : item.id;
    if (seen.has(id)) continue;
    if (source === "openai" || source === "gemini") {
      if (NON_CHAT_PATTERN.test(id)) continue;
      if (source === "gemini" && !id.startsWith("gemini")) continue;
    }
    seen.add(id);
    const label =
      typeof item.display_name === "string" && item.display_name !== "" ? item.display_name : null;
    const created = typeof item.created === "number" ? item.created : 0;
    models.push({ info: { id, label, sizeBytes: null, contextLength: null }, created });
  }
  // Anthropic lists newest first already; OpenAI gives a creation time to sort by.
  if (source === "openai") models.sort((a, b) => b.created - a.created);
  return models.map((model) => model.info);
}
