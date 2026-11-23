// protects=the engine answers an AI connection test with the service's result, reports an unexpected service failure as unknown without its message, and keeps answering pings;
// fails_when=a test request gets no reply, a thrown error text is passed back to main, or the reply is sent to a different request id;
// no_claim=the real provider call and the utility process transport are not exercised here; the supervisor test covers the round trip through main.
import { describe, expect, it } from "vitest";
import type { AiConnectionResult, AiProviderConfig } from "@job-finder/core/ai";
import type { PortLike } from "./port";
import { createEngineRuntime, type EngineServices } from "./runtime";

interface FakePort extends PortLike {
  deliver(message: unknown): void;
  sent: unknown[];
}

function fakePort(): FakePort {
  let listener: ((data: unknown) => void) | undefined;
  const sent: unknown[] = [];
  return {
    sent,
    postMessage: (message) => void sent.push(message),
    on: (_event, next) => {
      listener = next;
    },
    start: () => {},
    close: () => {},
    deliver: (message) => listener?.(message),
  };
}

const config: AiProviderConfig = {
  provider: "anthropic",
  model: "claude-test",
  baseUrl: "",
  apiKey: "sk-test-key",
};

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("engine runtime", () => {
  it("answers an AI test with the service result under the same request id", async () => {
    const port = fakePort();
    const services: EngineServices = {
      testAiConnection: async () => ({ ok: true, model: "claude-test" }),
    };
    createEngineRuntime(port, services);

    port.deliver({ type: "ai-test", id: 7, config });
    await settle();

    expect(port.sent).toEqual([
      { type: "ai-test-result", id: 7, result: { ok: true, model: "claude-test" } },
    ]);
  });

  it("reports an unexpected service failure as unknown, without the error text", async () => {
    const port = fakePort();
    const services: EngineServices = {
      testAiConnection: async () => {
        throw new Error(`boom with ${config.apiKey}`);
      },
    };
    createEngineRuntime(port, services);

    port.deliver({ type: "ai-test", id: 3, config });
    await settle();

    const [reply] = port.sent as Array<{ result: AiConnectionResult }>;
    expect(reply?.result).toEqual({ ok: false, code: "unknown" });
    expect(JSON.stringify(port.sent)).not.toContain(config.apiKey);
  });

  it("still answers pings", () => {
    const port = fakePort();
    createEngineRuntime(port, { testAiConnection: async () => ({ ok: false, code: "unknown" }) });

    port.deliver({ type: "ping", id: 1 });

    expect(port.sent).toEqual([{ type: "pong", id: 1 }]);
  });
});
