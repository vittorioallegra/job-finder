// protects=the model menu reads each provider's model list at the right address with the right key header, keeps only chat models, and reports a code the settings screen explains;
// fails_when=the key goes in the wrong header or to Ollama, the /v1 path is kept for Ollama's tags, non-chat models fill the menu, Gemini ids keep their models/ prefix, or a rejected key is reported as unreachable;
// no_claim=scripted fetches stand in for the providers, so their real answers are not checked here.
import { describe, expect, it } from "vitest";
import { listAiModels } from "./models";

function scripted(response: () => Response | Promise<Response>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: { ...(init?.headers as Record<string, string>) } });
    return response();
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const json =
  (body: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(body), { status });

describe("listAiModels", () => {
  it("reads Anthropic's list with its key header and keeps the display names", async () => {
    const { fetch, calls } = scripted(
      json({ data: [{ id: "claude-new", display_name: "Claude New" }, { id: "claude-old" }] }),
    );
    const outcome = await listAiModels(
      { source: "anthropic", baseUrl: "", apiKey: "sk-ant" },
      { fetch },
    );
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/models?limit=1000");
    expect(calls[0]?.headers["x-api-key"]).toBe("sk-ant");
    expect(calls[0]?.headers.authorization).toBeUndefined();
    expect(outcome).toEqual({
      ok: true,
      models: [
        { id: "claude-new", label: "Claude New", sizeBytes: null },
        { id: "claude-old", label: null, sizeBytes: null },
      ],
    });
  });

  it("keeps only OpenAI chat models, newest first", async () => {
    const { fetch, calls } = scripted(
      json({
        data: [
          { id: "gpt-old", created: 1 },
          { id: "text-embedding-3-small", created: 5 },
          { id: "whisper-1", created: 6 },
          { id: "gpt-new", created: 9 },
        ],
      }),
    );
    const outcome = await listAiModels({ source: "openai", baseUrl: "", apiKey: "sk" }, { fetch });
    expect(calls[0]?.headers.authorization).toBe("Bearer sk");
    expect(outcome.ok && outcome.models.map((model) => model.id)).toEqual(["gpt-new", "gpt-old"]);
  });

  it("strips Gemini's models/ prefix and drops non-chat models", async () => {
    const { fetch, calls } = scripted(
      json({
        data: [
          { id: "models/gemini-flash" },
          { id: "models/text-embedding-004" },
          { id: "models/gemini-embedding-001" },
          { id: "models/imagen-3" },
        ],
      }),
    );
    const outcome = await listAiModels(
      {
        source: "gemini",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
        apiKey: "g",
      },
      { fetch },
    );
    expect(calls[0]?.url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/models");
    expect(outcome.ok && outcome.models.map((model) => model.id)).toEqual(["gemini-flash"]);
  });

  it("reads Ollama's tags at the server root, sorted, and sends no key", async () => {
    const { fetch, calls } = scripted(
      json({
        models: [
          { name: "qwen3:8b", size: 5_200_000_000 },
          { model: "gemma3:4b" },
          { size: 1 },
          "junk",
        ],
      }),
    );
    const outcome = await listAiModels(
      { source: "ollama", baseUrl: " http://localhost:11434/v1 ", apiKey: "unused" },
      { fetch },
    );
    expect(calls[0]?.url).toBe("http://localhost:11434/api/tags");
    expect(calls[0]?.headers.authorization).toBeUndefined();
    expect(outcome).toEqual({
      ok: true,
      models: [
        { id: "gemma3:4b", label: null, sizeBytes: null },
        { id: "qwen3:8b", label: null, sizeBytes: 5_200_000_000 },
      ],
    });
  });

  it("reads an OpenAI-compatible server's list under its base URL, without a key when none is given", async () => {
    const { fetch, calls } = scripted(json({ data: [{ id: "local-model" }] }));
    await listAiModels(
      { source: "openai-compatible", baseUrl: "http://localhost:1234/v1/", apiKey: null },
      { fetch },
    );
    expect(calls[0]?.url).toBe("http://localhost:1234/v1/models");
    expect(calls[0]?.headers.authorization).toBeUndefined();
  });

  it("reports a rejected key, a missing server and a foreign answer with their codes", async () => {
    const rejected = scripted(json({ error: "no" }, 401));
    expect(
      await listAiModels(
        { source: "openai", baseUrl: "", apiKey: "bad" },
        { fetch: rejected.fetch },
      ),
    ).toEqual({ ok: false, code: "invalid-key" });
    const down = scripted(() => Promise.reject(new TypeError("fetch failed")));
    expect(
      await listAiModels(
        { source: "ollama", baseUrl: "http://localhost:11434/v1", apiKey: null },
        { fetch: down.fetch },
      ),
    ).toEqual({ ok: false, code: "unreachable" });
    const html = scripted(() => new Response("<html></html>"));
    expect(
      await listAiModels(
        { source: "ollama", baseUrl: "http://localhost:11434/v1", apiKey: null },
        { fetch: html.fetch },
      ),
    ).toEqual({ ok: false, code: "invalid-response" });
    const bad = scripted(json({}));
    expect(
      await listAiModels(
        { source: "openai-compatible", baseUrl: "not a url", apiKey: null },
        { fetch: bad.fetch },
      ),
    ).toEqual({ ok: false, code: "unreachable" });
    expect(bad.calls).toEqual([]);
  });
});
