// protects=Ollama on this computer is called through its own chat API with the context size the user chose, so that choice holds whatever Ollama was started with, and with the JSON schema enforced; other OpenAI-compatible servers keep the OpenAI wire format;
// fails_when=Ollama is called through /v1 (which ignores the context size), the chosen size is not sent as num_ctx, or another server is sent to Ollama's API;
// no_claim=a scripted fetch stands in for Ollama, so the model's answer and its memory use are not checked here.
import { generateText } from "ai";
import { describe, expect, it } from "vitest";
import { createAiModel, isLocalAiEndpoint, isOllamaEndpoint } from "./provider";

function recording(answer: unknown) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(answer), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const ollamaAnswer = {
  model: "gemma4:12b",
  created_at: "2026-11-24T10:00:00Z",
  message: { role: "assistant", content: "ok" },
  done: true,
  done_reason: "stop",
  prompt_eval_count: 5,
  eval_count: 1,
};

describe("Ollama", () => {
  it("recognises Ollama only on a loopback host and its port", () => {
    expect(isOllamaEndpoint("http://localhost:11434/v1")).toBe(true);
    expect(isOllamaEndpoint("http://127.0.0.1:11434")).toBe(true);
    expect(isOllamaEndpoint("http://localhost:1234/v1")).toBe(false);
    expect(isOllamaEndpoint("http://192.168.1.20:11434/v1")).toBe(false);
  });

  it("calls Ollama's chat API with the chosen context size", async () => {
    const { fetch, calls } = recording(ollamaAnswer);
    const { model } = createAiModel(
      {
        provider: "openai-compatible",
        model: "gemma4:12b",
        baseUrl: "http://localhost:11434/v1",
        apiKey: null,
        contextSize: 16384,
      },
      { fetch },
    );
    const result = await generateText({ model, prompt: "Reply ok", maxRetries: 0 });
    expect(result.text).toBe("ok");
    expect(calls[0]?.url).toBe("http://localhost:11434/api/chat");
    expect(calls[0]?.body.options).toMatchObject({ num_ctx: 16384 });
  });

  it("asks Ollama to follow the JSON schema, so the model cannot use fields of its own", async () => {
    const { fetch } = recording(ollamaAnswer);
    const handle = createAiModel(
      {
        provider: "openai-compatible",
        model: "gemma4:12b",
        baseUrl: "http://localhost:11434/v1",
        apiKey: null,
      },
      { fetch },
    );
    expect(handle.capabilities.nativeStructuredOutput).toBe(true);
    expect(
      createAiModel(
        {
          provider: "openai-compatible",
          model: "local",
          baseUrl: "http://localhost:1234/v1",
          apiKey: null,
        },
        { fetch },
      ).capabilities.nativeStructuredOutput,
    ).toBe(false);
  });

  it("tells a server on this computer from a remote one", () => {
    expect(
      isLocalAiEndpoint({ provider: "openai-compatible", baseUrl: "http://localhost:1234/v1" }),
    ).toBe(true);
    expect(
      isLocalAiEndpoint({ provider: "openai-compatible", baseUrl: "https://llm.example.com/v1" }),
    ).toBe(false);
    expect(isLocalAiEndpoint({ provider: "anthropic", baseUrl: "" })).toBe(false);
  });

  it("keeps the OpenAI wire format for another local server", async () => {
    const { fetch, calls } = recording({
      id: "x",
      object: "chat.completion",
      created: 1,
      model: "local",
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    });
    const { model } = createAiModel(
      {
        provider: "openai-compatible",
        model: "local",
        baseUrl: "http://localhost:1234/v1",
        apiKey: null,
        contextSize: 16384,
      },
      { fetch },
    );
    await generateText({ model, prompt: "Reply ok", maxRetries: 0 });
    expect(calls[0]?.url).toBe("http://localhost:1234/v1/chat/completions");
    expect(calls[0]?.body.options).toBeUndefined();
  });
});
