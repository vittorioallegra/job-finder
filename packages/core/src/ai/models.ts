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
  return models === null ? { ok: false, code: "invalid-response" } : { ok: true, models };
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
    models.push({ info: { id, label, sizeBytes: null }, created });
  }
  // Anthropic lists newest first already; OpenAI gives a creation time to sort by.
  if (source === "openai") models.sort((a, b) => b.created - a.created);
  return models.map((model) => model.info);
}
