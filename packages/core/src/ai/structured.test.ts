// protects=generateStructured returns a value that matches the schema, repairs one invalid answer, reports an oversized prompt, and maps provider failures to AiError codes;
// fails_when=an invalid answer is returned unchecked, a second invalid answer is retried more than once, a provider 401 surfaces as a generic error, or an oversized prompt raises no warning;
// no_claim=the scripted provider answers are hand-written test doubles, not recordings of a real model, so the quality of real structured output is not shown.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { generateStructured } from "./structured";
import { createAiModel, type AiProviderConfig } from "./provider";
import { AiError } from "./errors";
import { AI_CAPABILITIES } from "./capabilities";

const schema = z.strictObject({ title: z.string().min(1) });

function chatCompletion(content: string) {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 0,
      model: "local-test",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** Test double for the network: answers each request in order and counts them. */
function scriptedFetch(answers: Array<() => Response>) {
  const seen: string[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    seen.push(typeof init?.body === "string" ? init.body : "");
    const next = answers[seen.length - 1];
    if (!next) {
      throw new Error("unexpected extra request");
    }
    return next();
  };
  return { fetchImpl, seen };
}

function compatibleModel(fetchImpl: typeof fetch) {
  const config: AiProviderConfig = {
    provider: "openai-compatible",
    model: "local-test",
    baseUrl: "http://localhost:1234/v1",
    apiKey: null,
  };
  return createAiModel(config, { fetch: fetchImpl });
}

describe("generateStructured with JSON-mode fallback", () => {
  it("parses a valid answer wrapped in a Markdown code fence", async () => {
    const { fetchImpl } = scriptedFetch([
      () => chatCompletion('```json\n{"title":"Engineer"}\n```'),
    ]);
    const { model, capabilities } = compatibleModel(fetchImpl);
    const result = await generateStructured({
      model,
      capabilities,
      schema,
      prompt: "Give the title.",
      contextSize: 8192,
    });
    expect(result.value).toEqual({ title: "Engineer" });
    expect(result.warnings).toEqual([]);
  });

  it("repairs one invalid answer with a single retry", async () => {
    const { fetchImpl, seen } = scriptedFetch([
      () => chatCompletion('{"title":""}'),
      () => chatCompletion('{"title":"Engineer"}'),
    ]);
    const { model, capabilities } = compatibleModel(fetchImpl);
    const result = await generateStructured({
      model,
      capabilities,
      schema,
      prompt: "Give the title.",
      contextSize: 8192,
    });
    expect(result.value).toEqual({ title: "Engineer" });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toContain("was rejected");
  });

  it("fails with invalid-output after the repair answer is also invalid, without a third request", async () => {
    const { fetchImpl, seen } = scriptedFetch([
      () => chatCompletion("not json at all"),
      () => chatCompletion("still not json"),
    ]);
    const { model, capabilities } = compatibleModel(fetchImpl);
    const failure = await generateStructured({
      model,
      capabilities,
      schema,
      prompt: "Give the title.",
      contextSize: 8192,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AiError);
    expect((failure as AiError).code).toBe("invalid-output");
    expect(seen).toHaveLength(2);
  });

  it("warns when the prompt plus the output reserve exceeds the context size", async () => {
    const { fetchImpl } = scriptedFetch([() => chatCompletion('{"title":"Engineer"}')]);
    const { model, capabilities } = compatibleModel(fetchImpl);
    const result = await generateStructured({
      model,
      capabilities,
      schema,
      prompt: "x".repeat(40_000),
      contextSize: 2048,
    });
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "context-exceeded", contextSize: 2048 }),
    ]);
  });

  it("maps a provider 401 to invalid-key", async () => {
    const { fetchImpl } = scriptedFetch([
      () =>
        new Response('{"error":"nope"}', {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    ]);
    const { model, capabilities } = compatibleModel(fetchImpl);
    const failure = await generateStructured({
      model,
      capabilities,
      schema,
      prompt: "Give the title.",
      contextSize: 8192,
    }).catch((error: unknown) => error);
    expect((failure as AiError).code).toBe("invalid-key");
  });
});

describe("capability table", () => {
  it("keeps native structured output for the hosted providers only", () => {
    expect(AI_CAPABILITIES.anthropic.nativeStructuredOutput).toBe(true);
    expect(AI_CAPABILITIES.openai.nativeStructuredOutput).toBe(true);
    expect(AI_CAPABILITIES["openai-compatible"].nativeStructuredOutput).toBe(false);
  });
});

describe("generateStructured with native structured output", () => {
  it("uses the provider's output mode and returns the validated object", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      seen.push(typeof init?.body === "string" ? init.body : "");
      return new Response(
        JSON.stringify({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "claude-test",
          content: [{ type: "text", text: '{"title":"Engineer"}' }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const { model, capabilities } = createAiModel(
      { provider: "anthropic", model: "claude-test", baseUrl: "", apiKey: "test-key" },
      { fetch: fetchImpl },
    );
    const result = await generateStructured({
      model,
      capabilities,
      schema,
      prompt: "Give the title.",
      contextSize: 8192,
    });
    expect(result.value).toEqual({ title: "Engineer" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("json_schema");
  });
});
