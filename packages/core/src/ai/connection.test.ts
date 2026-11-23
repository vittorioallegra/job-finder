// protects=testAiConnection reports success with the model name, or a failure code that the settings screen can explain, without a request leaving the process;
// fails_when=a rejected key is reported as connected, a network failure is reported as a missing model, or a missing key still sends a request;
// no_claim=the scripted fetch stands in for the provider, so the real endpoint, its latency and its model list are not checked.
import { describe, expect, it } from "vitest";
import { testAiConnection } from "./connection";

const anthropicOk = () =>
  new Response(
    JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-test",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

describe("testAiConnection", () => {
  it("reports the model name when the provider answers", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return anthropicOk();
    };
    const result = await testAiConnection(
      { provider: "anthropic", model: "claude-test", baseUrl: "", apiKey: "test-key" },
      { fetch: fetchImpl },
    );
    expect(result).toEqual({ ok: true, model: "claude-test" });
    expect(calls).toBe(1);
  });

  it("reports invalid-key when the provider rejects the key", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response('{"type":"error","error":{"type":"authentication_error"}}', {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    const result = await testAiConnection(
      { provider: "anthropic", model: "claude-test", baseUrl: "", apiKey: "test-key" },
      { fetch: fetchImpl },
    );
    expect(result).toEqual({ ok: false, code: "invalid-key" });
  });

  it("reports unreachable when the connection fails", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const result = await testAiConnection(
      {
        provider: "openai-compatible",
        model: "local",
        baseUrl: "http://localhost:1/v1",
        apiKey: null,
      },
      { fetch: fetchImpl },
    );
    expect(result).toEqual({ ok: false, code: "unreachable" });
  });

  it("reports not-configured without sending a request when the key is missing", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return anthropicOk();
    };
    const result = await testAiConnection(
      { provider: "anthropic", model: "claude-test", baseUrl: "", apiKey: null },
      { fetch: fetchImpl },
    );
    expect(result).toEqual({ ok: false, code: "not-configured" });
    expect(calls).toBe(0);
  });
});
