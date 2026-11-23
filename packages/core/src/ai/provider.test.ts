// protects=createAiModel refuses to build a model without the settings that provider needs and picks the structured output mode from the capability table;
// fails_when=a missing model, key or base URL builds a model anyway, or a provider is given the wrong structured output mode;
// no_claim=no request is sent, so the wire format and endpoint URL of each provider are not checked here.
import { describe, expect, it } from "vitest";
import { createAiModel, type AiProviderConfig } from "./provider";
import { AiError } from "./errors";

const base: AiProviderConfig = {
  provider: "anthropic",
  model: "claude-test",
  baseUrl: "",
  apiKey: "test-key",
};

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof AiError ? error.code : "other";
  }
}

describe("createAiModel", () => {
  it("refuses an empty model name", () => {
    expect(codeOf(() => createAiModel({ ...base, model: "  " }))).toBe("not-configured");
  });

  it("requires an API key for the hosted providers", () => {
    expect(codeOf(() => createAiModel({ ...base, apiKey: null }))).toBe("not-configured");
    expect(codeOf(() => createAiModel({ ...base, provider: "openai", apiKey: "   " }))).toBe(
      "not-configured",
    );
  });

  it("requires a base URL for the OpenAI-compatible provider, but not a key", () => {
    const compatible = { ...base, provider: "openai-compatible" as const, apiKey: null };
    expect(codeOf(() => createAiModel({ ...compatible, baseUrl: "" }))).toBe("not-configured");
    expect(
      codeOf(() => createAiModel({ ...compatible, baseUrl: "http://localhost:11434/v1" })),
    ).toBeUndefined();
  });

  it("ignores a stored base URL for the hosted providers so their key never goes to another host", async () => {
    // protects=an Anthropic or OpenAI key is only sent to the vendor's own host; fails_when=a base URL left from an earlier OpenAI-compatible setup redirects the hosted request; no_claim=the vendor endpoint paths;
    for (const provider of ["anthropic", "openai"] as const) {
      const urls: string[] = [];
      const handle = createAiModel(
        { ...base, provider, baseUrl: "http://192.168.1.20:11434/v1" },
        {
          fetch: (async (input: RequestInfo | URL) => {
            urls.push(String(input));
            return new Response("{}", { status: 500 });
          }) as typeof fetch,
        },
      );
      await (handle.model as unknown as { doGenerate(options: unknown): Promise<unknown> })
        .doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] })
        .catch(() => undefined);
      expect(urls.length).toBeGreaterThan(0);
      expect(urls.every((url) => !url.includes("192.168.1.20"))).toBe(true);
    }
  });

  it("uses native structured output for the hosted providers and the JSON-mode fallback for compatible servers", () => {
    expect(createAiModel(base).capabilities.nativeStructuredOutput).toBe(true);
    expect(createAiModel({ ...base, provider: "openai" }).capabilities.nativeStructuredOutput).toBe(
      true,
    );
    expect(
      createAiModel({
        ...base,
        provider: "openai-compatible",
        baseUrl: "http://localhost:1234/v1",
        apiKey: null,
      }).capabilities.nativeStructuredOutput,
    ).toBe(false);
  });
});
