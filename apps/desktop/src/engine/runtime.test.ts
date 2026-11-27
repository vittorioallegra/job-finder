// protects=the engine renders pages through main only after the URL is resolved and allowed by robots.txt, and matches main's answer to its request id; the engine answers an AI connection test, a document request and a form mapping with the service's result (a failed document request reports only its code), reports an unexpected service failure as unknown without its message, relays ingestion start and cancel to its controller and answers the start under its request id, and keeps answering pings;
// fails_when=a profile review answer is lost or leaks the key, a test request gets no reply, a thrown error text is passed back to main, or the reply is sent to a different request id;
// no_claim=the real provider call and the utility process transport are not exercised here; the supervisor test covers the round trip through main.
import { describe, expect, it } from "vitest";
import type { AiConnectionResult, AiProviderConfig } from "@job-finder/core/ai";
import type { DiscoveryCriteria } from "@job-finder/core/discovery/types";
import { emptyProfile } from "@job-finder/core/profile";
import type { HttpClient } from "@job-finder/core/net";
import type { PortLike } from "./port";
import { createEngineRuntime, type EngineServices } from "./runtime";

/** Resolves every URL as given and allows it; the page-render tests replace this where needed. */
function fakeNet(overrides: Partial<HttpClient> = {}): HttpClient {
  return {
    resolve: (url) => url,
    isAllowed: async () => true,
    get: async (url) => ({ ok: false, code: "network", url }),
    post: async (url) => ({ ok: false, code: "network", url }),
    ...overrides,
  };
}

/** An ingestion controller that answers nothing; the ingestion tests replace it. */
const noIngest = () => ({ start: () => "accepted" as const, cancel: () => {} });

/** A document generator that answers nothing; the document tests replace it. */
const noDocuments = async () => ({ ok: false as const, code: "unknown" as const });
const noMapping = async () => ({ ok: false as const, code: "unknown" as const });
const noReview = async () => ({ ok: false as const, code: "unknown" as const });

/** A scoring runner that answers nothing; the scoring tests replace it. */
const noScoring = () => ({
  score: async () => ({ ok: false as const, code: "store-failed" as const }),
});

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
      createIngest: noIngest,
      checkForUpdate: async () => ({ ok: false as const, code: "unavailable" as const }),
      listModels: async () => ({ ok: false as const, code: "unreachable" as const }),
      createScoring: noScoring,
      mapFormFields: noMapping,
      generateDocument: noDocuments,
      reviewProfile: noReview,
      net: fakeNet(),
      testAiConnection: async () => ({ ok: true, model: "claude-test" }),
      importCv: async () => ({ ok: false, code: "unknown" }),
      discoverCompanies: async () => ({ ok: false, code: "search-failed" }),
    };
    createEngineRuntime(port, services);

    port.deliver({ type: "ai-test", id: 7, config });
    await settle();

    expect(port.sent).toEqual([
      { type: "ai-test-result", id: 7, result: { ok: true, model: "claude-test" } },
    ]);
  });

  it("answers a form mapping with the service result under the same request id", async () => {
    const port = fakePort();
    const services: EngineServices = {
      createIngest: noIngest,
      checkForUpdate: async () => ({ ok: false as const, code: "unavailable" as const }),
      listModels: async () => ({ ok: false as const, code: "unreachable" as const }),
      createScoring: noScoring,
      mapFormFields: async () => ({ ok: true, answers: [] }),
      generateDocument: noDocuments,
      reviewProfile: noReview,
      net: fakeNet(),
      testAiConnection: async () => ({ ok: true, model: "claude-test" }),
      importCv: async () => ({ ok: false, code: "unknown" }),
      discoverCompanies: async () => ({ ok: false, code: "search-failed" }),
    };
    createEngineRuntime(port, services);

    port.deliver({
      type: "map-form-fields",
      id: 9,
      request: {
        fields: [],
        profile: emptyProfile(),
        language: "en",
        ai: { config, contextSize: 8192 },
      },
    });
    await settle();

    expect(port.sent).toEqual([
      { type: "map-form-fields-result", id: 9, outcome: { ok: true, answers: [] } },
    ]);
  });

  it("answers a profile review with the service result, and a failing service as unknown", async () => {
    const port = fakePort();
    let calls = 0;
    const services: EngineServices = {
      createIngest: noIngest,
      checkForUpdate: async () => ({ ok: false as const, code: "unavailable" as const }),
      listModels: async () => ({ ok: false as const, code: "unreachable" as const }),
      createScoring: noScoring,
      mapFormFields: noMapping,
      generateDocument: noDocuments,
      reviewProfile: async () => {
        calls += 1;
        if (calls === 2) throw new Error(`boom with ${config.apiKey}`);
        return { ok: true as const, review: { summary: "Fine.", suggestions: [] } };
      },
      net: fakeNet(),
      testAiConnection: async () => ({ ok: false as const, code: "unknown" as const }),
      importCv: async () => ({ ok: false, code: "unknown" }),
      discoverCompanies: async () => ({ ok: false, code: "search-failed" }),
    };
    createEngineRuntime(port, services);
    const request = {
      profile: emptyProfile(),
      language: "en" as const,
      ai: { config, contextSize: 8192 },
    };

    port.deliver({ type: "review-profile", id: 4, request });
    port.deliver({ type: "review-profile", id: 5, request });
    await settle();

    expect(port.sent).toEqual([
      {
        type: "review-profile-result",
        id: 4,
        outcome: { ok: true, review: { summary: "Fine.", suggestions: [] } },
      },
      { type: "review-profile-result", id: 5, outcome: { ok: false, code: "unknown" } },
    ]);
    expect(JSON.stringify(port.sent)).not.toContain(config.apiKey);
  });

  it("reports an unexpected service failure as unknown, without the error text", async () => {
    const port = fakePort();
    const services: EngineServices = {
      createIngest: noIngest,
      checkForUpdate: async () => ({ ok: false as const, code: "unavailable" as const }),
      listModels: async () => ({ ok: false as const, code: "unreachable" as const }),
      createScoring: noScoring,
      mapFormFields: noMapping,
      generateDocument: noDocuments,
      reviewProfile: noReview,
      net: fakeNet(),
      testAiConnection: async () => {
        throw new Error(`boom with ${config.apiKey}`);
      },
      importCv: async () => ({ ok: false, code: "unknown" }),
      discoverCompanies: async () => ({ ok: false, code: "search-failed" }),
    };
    createEngineRuntime(port, services);

    port.deliver({ type: "ai-test", id: 3, config });
    await settle();

    const [reply] = port.sent as Array<{ result: AiConnectionResult }>;
    expect(reply?.result).toEqual({ ok: false, code: "unknown" });
    expect(JSON.stringify(port.sent)).not.toContain(config.apiKey);
  });

  it("answers a CV import with the service outcome under the same request id", async () => {
    const port = fakePort();
    const services: EngineServices = {
      createIngest: noIngest,
      checkForUpdate: async () => ({ ok: false as const, code: "unavailable" as const }),
      listModels: async () => ({ ok: false as const, code: "unreachable" as const }),
      createScoring: noScoring,
      mapFormFields: noMapping,
      generateDocument: noDocuments,
      reviewProfile: noReview,
      net: fakeNet(),
      testAiConnection: async () => ({ ok: false, code: "unknown" }),
      importCv: async (request) => {
        expect(request.fileName).toBe("cv.txt");
        return { ok: false, code: "empty-document" };
      },
      discoverCompanies: async () => ({ ok: false, code: "search-failed" }),
    };
    createEngineRuntime(port, services);

    port.deliver({
      type: "cv-import",
      id: 9,
      request: { config, contextSize: 8192, fileName: "cv.txt", bytes: new Uint8Array([32]) },
    });
    await settle();

    expect(port.sent).toEqual([
      { type: "cv-import-result", id: 9, outcome: { ok: false, code: "empty-document" } },
    ]);
  });

  it("answers a document request with the generator outcome under the same request id", async () => {
    const port = fakePort();
    const seen: string[] = [];
    const services: EngineServices = {
      createIngest: noIngest,
      checkForUpdate: async () => ({ ok: false as const, code: "unavailable" as const }),
      listModels: async () => ({ ok: false as const, code: "unreachable" as const }),
      createScoring: noScoring,
      mapFormFields: noMapping,
      reviewProfile: noReview,
      generateDocument: async (request) => {
        seen.push(`${request.kind}:${request.language}:${request.ai.config.apiKey}`);
        return { ok: false, code: "invalid-key" };
      },
      net: fakeNet(),
      testAiConnection: async () => ({ ok: false, code: "unknown" }),
      importCv: async () => ({ ok: false, code: "unknown" }),
      discoverCompanies: async () => ({ ok: false, code: "search-failed" }),
    };
    createEngineRuntime(port, services);

    port.deliver({
      type: "generate-document",
      id: 12,
      request: {
        kind: "cv",
        profile: { ...emptyProfile() },
        job: { title: "Engineer", companyName: "Acme", description: "APIs." },
        language: "it",
        ai: { config, contextSize: 8192 },
      },
    });
    await settle();

    expect(seen).toEqual(["cv:it:sk-test-key"]);
    expect(port.sent).toEqual([
      { type: "generate-document-result", id: 12, outcome: { ok: false, code: "invalid-key" } },
    ]);
  });

  it("reports an unexpected document failure as unknown, without the error text", async () => {
    const port = fakePort();
    const services: EngineServices = {
      createIngest: noIngest,
      checkForUpdate: async () => ({ ok: false as const, code: "unavailable" as const }),
      listModels: async () => ({ ok: false as const, code: "unreachable" as const }),
      createScoring: noScoring,
      mapFormFields: noMapping,
      reviewProfile: noReview,
      generateDocument: async () => {
        throw new Error("secret detail from the provider");
      },
      net: fakeNet(),
      testAiConnection: async () => ({ ok: false, code: "unknown" }),
      importCv: async () => ({ ok: false, code: "unknown" }),
      discoverCompanies: async () => ({ ok: false, code: "search-failed" }),
    };
    createEngineRuntime(port, services);

    port.deliver({
      type: "generate-document",
      id: 13,
      request: {
        kind: "cover-letter",
        profile: { ...emptyProfile() },
        job: { title: "Engineer", companyName: "Acme", description: "APIs." },
        language: "en",
        ai: { config, contextSize: 8192 },
      },
    });
    await settle();

    expect(port.sent).toEqual([
      { type: "generate-document-result", id: 13, outcome: { ok: false, code: "unknown" } },
    ]);
  });

  it("reports an unexpected CV import failure as unknown", async () => {
    const port = fakePort();
    const services: EngineServices = {
      createIngest: noIngest,
      checkForUpdate: async () => ({ ok: false as const, code: "unavailable" as const }),
      listModels: async () => ({ ok: false as const, code: "unreachable" as const }),
      createScoring: noScoring,
      mapFormFields: noMapping,
      generateDocument: noDocuments,
      reviewProfile: noReview,
      net: fakeNet(),
      testAiConnection: async () => ({ ok: false, code: "unknown" }),
      importCv: async () => {
        throw new Error("parser crashed on the CV text");
      },
      discoverCompanies: async () => ({ ok: false, code: "search-failed" }),
    };
    createEngineRuntime(port, services);

    port.deliver({
      type: "cv-import",
      id: 10,
      request: { config, contextSize: 8192, fileName: "cv.txt", bytes: new Uint8Array([32]) },
    });
    await settle();

    expect(port.sent).toEqual([
      { type: "cv-import-result", id: 10, outcome: { ok: false, code: "unknown" } },
    ]);
  });

  it("stops a running CV import when main cancels it, and answers cancelled", async () => {
    const port = fakePort();
    const signals: AbortSignal[] = [];
    const services: EngineServices = {
      createIngest: noIngest,
      checkForUpdate: async () => ({ ok: false as const, code: "unavailable" as const }),
      listModels: async () => ({ ok: false as const, code: "unreachable" as const }),
      createScoring: noScoring,
      mapFormFields: noMapping,
      generateDocument: noDocuments,
      reviewProfile: noReview,
      net: fakeNet(),
      testAiConnection: async () => ({ ok: false, code: "unknown" }),
      // Like a model call: it ends only when its signal aborts, then fails as a timeout would.
      importCv: (_request, signal) =>
        new Promise((resolve) => {
          signals.push(signal);
          signal.addEventListener("abort", () => resolve({ ok: false, code: "timeout" }));
        }),
      discoverCompanies: async () => ({ ok: false, code: "search-failed" }),
    };
    createEngineRuntime(port, services);

    port.deliver({
      type: "cv-import",
      id: 11,
      request: { config, contextSize: 8192, fileName: "cv.txt", bytes: new Uint8Array([32]) },
    });
    await settle();
    expect(port.sent).toEqual([]);
    port.deliver({ type: "cv-import-cancel" });
    await settle();

    expect(signals[0]?.aborted).toBe(true);
    expect(port.sent).toEqual([
      { type: "cv-import-result", id: 11, outcome: { ok: false, code: "cancelled" } },
    ]);
  });

  it("still answers pings", () => {
    const port = fakePort();
    createEngineRuntime(port, {
      createIngest: noIngest,
      checkForUpdate: async () => ({ ok: false as const, code: "unavailable" as const }),
      listModels: async () => ({ ok: false as const, code: "unreachable" as const }),
      createScoring: noScoring,
      mapFormFields: noMapping,
      generateDocument: noDocuments,
      reviewProfile: noReview,
      net: fakeNet(),
      testAiConnection: async () => ({ ok: false, code: "unknown" }),
      importCv: async () => ({ ok: false, code: "unknown" }),
      discoverCompanies: async () => ({ ok: false, code: "search-failed" }),
    });

    port.deliver({ type: "ping", id: 1 });

    expect(port.sent).toEqual([{ type: "pong", id: 1 }]);
  });

  describe("page render", () => {
    function servicesWith(net: HttpClient): EngineServices {
      return {
        net,
        createIngest: noIngest,
        checkForUpdate: async () => ({ ok: false as const, code: "unavailable" as const }),
        listModels: async () => ({ ok: false as const, code: "unreachable" as const }),
        createScoring: noScoring,
        mapFormFields: noMapping,
        generateDocument: noDocuments,
        reviewProfile: noReview,
        testAiConnection: async () => ({ ok: false, code: "unknown" }),
        importCv: async () => ({ ok: false, code: "unknown" }),
        discoverCompanies: async () => ({ ok: false, code: "search-failed" }),
      };
    }

    it("sends the request with an id and resolves with main's answer", async () => {
      const port = fakePort();
      const runtime = createEngineRuntime(port, servicesWith(fakeNet()));

      const pending = runtime.renderPage("https://jobs.example.test/careers");
      await settle();
      const sent = port.sent.at(-1) as { type: string; id: number; url: string };
      port.deliver({
        type: "page-render-result",
        id: sent.id,
        result: { ok: true, url: sent.url, html: "<main>jobs</main>" },
      });

      expect(sent).toEqual({
        type: "page-render",
        id: expect.any(Number),
        url: "https://jobs.example.test/careers",
      });
      await expect(pending).resolves.toEqual({
        ok: true,
        url: "https://jobs.example.test/careers",
        html: "<main>jobs</main>",
      });
    });

    it("sends the fixture-resolved URL, not the original one", async () => {
      const port = fakePort();
      const runtime = createEngineRuntime(
        port,
        servicesWith(
          fakeNet({
            resolve: (url) => url.replace("https://jobs.example.test", "http://127.0.0.1:4010"),
          }),
        ),
      );

      void runtime.renderPage("https://jobs.example.test/careers");
      await settle();

      expect(port.sent).toEqual([
        { type: "page-render", id: expect.any(Number), url: "http://127.0.0.1:4010/careers" },
      ]);
    });

    it("never sends a URL that robots.txt disallows", async () => {
      const port = fakePort();
      const runtime = createEngineRuntime(
        port,
        servicesWith(fakeNet({ isAllowed: async () => false })),
      );

      const result = await runtime.renderPage("https://jobs.example.test/private");

      expect(result).toEqual({ ok: false, code: "blocked-by-robots" });
      expect(port.sent).toEqual([]);
    });

    it("never sends a URL that is not an http or https address", async () => {
      const port = fakePort();
      const runtime = createEngineRuntime(
        port,
        servicesWith(fakeNet({ resolve: () => undefined })),
      );

      const result = await runtime.renderPage("file:///etc/hosts");

      expect(result).toEqual({ ok: false, code: "invalid-url" });
      expect(port.sent).toEqual([]);
    });
  });

  it("passes a company-limited start to the controller", async () => {
    const port = fakePort();
    const started: Array<[string, string | undefined]> = [];
    createEngineRuntime(port, {
      net: fakeNet(),
      testAiConnection: async () => ({ ok: false, code: "unknown" }),
      importCv: async () => ({ ok: false, code: "unknown" }),
      discoverCompanies: async () => ({ ok: false, code: "search-failed" }),
      checkForUpdate: async () => ({ ok: false as const, code: "unavailable" as const }),
      listModels: async () => ({ ok: false as const, code: "unreachable" as const }),
      createScoring: noScoring,
      mapFormFields: noMapping,
      generateDocument: noDocuments,
      reviewProfile: noReview,
      createIngest: () => ({
        start: (runId, companyId) => {
          started.push([runId, companyId]);
          return "accepted";
        },
        cancel: () => {},
      }),
    });

    port.deliver({ type: "ingest-start", id: 5, runId: "run-10", companyId: "co-7" });
    await settle();

    expect(started).toEqual([["run-10", "co-7"]]);
    expect(port.sent).toEqual([{ type: "ingest-start-result", id: 5, code: "accepted" }]);
  });

  it("gives the controller the page renderer, and the AI settings of a start", async () => {
    const port = fakePort();
    let received: { ai: unknown; rendersPages: boolean } | undefined;
    createEngineRuntime(port, {
      net: fakeNet(),
      testAiConnection: async () => ({ ok: false, code: "unknown" }),
      importCv: async () => ({ ok: false, code: "unknown" }),
      discoverCompanies: async () => ({ ok: false, code: "search-failed" }),
      checkForUpdate: async () => ({ ok: false as const, code: "unavailable" as const }),
      listModels: async () => ({ ok: false as const, code: "unreachable" as const }),
      createScoring: noScoring,
      mapFormFields: noMapping,
      generateDocument: noDocuments,
      reviewProfile: noReview,
      createIngest: (api) => ({
        start: (_runId, _companyId, ai) => {
          received = { ai, rendersPages: typeof api.renderPage === "function" };
          return "accepted";
        },
        cancel: () => {},
      }),
    });
    const ai = {
      config: {
        provider: "openai-compatible",
        model: "local",
        baseUrl: "http://localhost:1/v1",
        apiKey: null,
      },
      contextSize: 8192,
    };

    port.deliver({ type: "ingest-start", id: 6, runId: "run-11", ai });
    await settle();

    expect(received).toEqual({ ai, rendersPages: true });
  });

  it("answers a company search with the discovery outcome under its request id", async () => {
    const port = fakePort();
    const asked: { criteria: DiscoveryCriteria; config: unknown }[] = [];
    createEngineRuntime(port, {
      net: fakeNet(),
      testAiConnection: async () => ({ ok: false, code: "unknown" }),
      importCv: async () => ({ ok: false, code: "unknown" }),
      createIngest: noIngest,
      checkForUpdate: async () => ({ ok: false as const, code: "unavailable" as const }),
      listModels: async () => ({ ok: false as const, code: "unreachable" as const }),
      createScoring: noScoring,
      mapFormFields: noMapping,
      generateDocument: noDocuments,
      reviewProfile: noReview,
      discoverCompanies: async (criteria, config) => {
        asked.push({ criteria, config });
        return { ok: false, code: "search-blocked" };
      },
    });

    port.deliver({
      type: "discover-companies",
      id: 12,
      criteria: { keywords: ["data"], locations: ["Milan"] },
      config: { duckduckgo: false, keyed: [{ provider: "brave", apiKey: "k" }] },
    });
    await settle();

    expect(asked).toEqual([
      {
        criteria: { keywords: ["data"], locations: ["Milan"] },
        config: { duckduckgo: false, keyed: [{ provider: "brave", apiKey: "k" }] },
      },
    ]);
    expect(port.sent).toEqual([
      { type: "discover-companies-result", id: 12, outcome: { ok: false, code: "search-blocked" } },
    ]);
  });

  it("reports an unexpected search failure as a search failure, without the error text", async () => {
    const port = fakePort();
    createEngineRuntime(port, {
      net: fakeNet(),
      testAiConnection: async () => ({ ok: false, code: "unknown" }),
      importCv: async () => ({ ok: false, code: "unknown" }),
      createIngest: noIngest,
      checkForUpdate: async () => ({ ok: false as const, code: "unavailable" as const }),
      listModels: async () => ({ ok: false as const, code: "unreachable" as const }),
      createScoring: noScoring,
      mapFormFields: noMapping,
      generateDocument: noDocuments,
      reviewProfile: noReview,
      discoverCompanies: async () => {
        throw new Error("secret detail");
      },
    });

    port.deliver({
      type: "discover-companies",
      id: 13,
      criteria: { keywords: ["x"], locations: [] },
      config: { duckduckgo: true, keyed: [] },
    });
    await settle();

    expect(port.sent).toEqual([
      { type: "discover-companies-result", id: 13, outcome: { ok: false, code: "search-failed" } },
    ]);
  });

  it("relays an ingestion start and cancel to the controller and answers the start under its id", async () => {
    const port = fakePort();
    const started: string[] = [];
    const cancelled: string[] = [];
    createEngineRuntime(port, {
      net: fakeNet(),
      testAiConnection: async () => ({ ok: false, code: "unknown" }),
      importCv: async () => ({ ok: false, code: "unknown" }),
      discoverCompanies: async () => ({ ok: false, code: "search-failed" }),
      checkForUpdate: async () => ({ ok: false as const, code: "unavailable" as const }),
      listModels: async () => ({ ok: false as const, code: "unreachable" as const }),
      createScoring: noScoring,
      mapFormFields: noMapping,
      generateDocument: noDocuments,
      reviewProfile: noReview,
      createIngest: () => ({
        start: (runId) => {
          started.push(runId);
          return "already-running";
        },
        cancel: (runId) => {
          cancelled.push(runId);
        },
      }),
    });

    port.deliver({ type: "ingest-start", id: 4, runId: "run-9" });
    port.deliver({ type: "ingest-cancel", runId: "run-9" });
    await settle();

    expect(port.sent).toEqual([{ type: "ingest-start-result", id: 4, code: "already-running" }]);
    expect(started).toEqual(["run-9"]);
    expect(cancelled).toEqual(["run-9"]);
  });
});
