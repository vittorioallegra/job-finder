// protects=a discovery search is relayed to the engine with the user's terms, the enabled sources and only the keyed providers that have a saved key, and every failure reaches the renderer as a code without the error text or a key;
// fails_when=the terms change on the way, a found board is dropped, a keyed provider runs without its toggle or key, a key is returned to the caller, an unreachable engine is reported as a search failure, or an error message leaks to the renderer;
// no_claim=the engine's requests to the search providers, which the core and engine tests cover, and the IPC payload check, which the handler tests cover.
import { describe, expect, it } from "vitest";
import type {
  DiscoveryCriteria,
  DiscoveryOutcome,
  SearchSourceConfig,
} from "@job-finder/core/discovery/types";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "@job-finder/bridge";
import { EngineUnavailableError } from "../engine/supervisor";
import { createDiscoveryService, type DiscoveryEngine } from "./service";

interface Asked {
  criteria: DiscoveryCriteria;
  config: SearchSourceConfig;
}

function engineAnswering(
  answer: () => Promise<DiscoveryOutcome>,
  asked: Asked[] = [],
): DiscoveryEngine {
  return {
    discoverCompanies: (criteria, config) => {
      asked.push({ criteria, config });
      return answer();
    },
  };
}

function settingsWith(overrides: Partial<AppSettings["search"]> = {}) {
  return {
    get: async (): Promise<AppSettings> => ({
      ...DEFAULT_APP_SETTINGS,
      search: { ...DEFAULT_APP_SETTINGS.search, ...overrides },
    }),
  };
}

function secretsWith(keys: Record<string, string>) {
  return { read: async (name: string) => keys[name] ?? null } as never;
}

const noKeys = secretsWith({});
const found: DiscoveryOutcome = {
  ok: true,
  candidates: [
    { ats: "lever", slug: "globex", careersUrl: "https://jobs.lever.co/globex", name: "globex" },
  ],
};

describe("discovery service", () => {
  it("relays the terms to the engine and returns the boards it found", async () => {
    const asked: Asked[] = [];
    const service = createDiscoveryService({
      engine: () => engineAnswering(async () => found, asked),
      settings: settingsWith(),
      secrets: noKeys,
    });

    const result = await service.search({ keywords: ["data"], locations: ["Milan"] });

    expect(asked[0]?.criteria).toEqual({ keywords: ["data"], locations: ["Milan"] });
    expect(result).toEqual(found);
  });

  it("passes a keyed provider only when its toggle is on and a key is saved", async () => {
    const asked: Asked[] = [];
    const service = createDiscoveryService({
      engine: () => engineAnswering(async () => found, asked),
      settings: settingsWith({ brave: true, tavily: false, serper: true }),
      secrets: secretsWith({ "search.brave": "brave-key", "search.tavily": "tavily-key" }),
    });

    await service.search({ keywords: ["x"], locations: [] });

    expect(asked[0]?.config).toEqual({
      duckduckgo: true,
      keyed: [{ provider: "brave", apiKey: "brave-key" }],
    });
  });

  it("passes the DuckDuckGo toggle through", async () => {
    const asked: Asked[] = [];
    const service = createDiscoveryService({
      engine: () => engineAnswering(async () => found, asked),
      settings: settingsWith({ duckduckgo: false }),
      secrets: noKeys,
    });

    await service.search({ keywords: ["x"], locations: [] });

    expect(asked[0]?.config.duckduckgo).toBe(false);
  });

  it("returns a blocked-search note alongside the boards, and never a key", async () => {
    const service = createDiscoveryService({
      engine: () => engineAnswering(async () => ({ ...found, searchBlocked: true })),
      settings: settingsWith({ brave: true }),
      secrets: secretsWith({ "search.brave": "brave-secret-value" }),
    });

    const result = await service.search({ keywords: ["x"], locations: [] });

    expect(result).toEqual({ ...found, searchBlocked: true });
    expect(JSON.stringify(result)).not.toContain("brave-secret-value");
  });

  it("reports a blocked search as its code", async () => {
    const service = createDiscoveryService({
      engine: () => engineAnswering(async () => ({ ok: false, code: "search-blocked" })),
      settings: settingsWith(),
      secrets: noKeys,
    });

    expect(await service.search({ keywords: ["x"], locations: [] })).toEqual({
      ok: false,
      code: "search-blocked",
    });
  });

  it("reports no engine, or an engine that is gone, as engine-unavailable", async () => {
    const none = createDiscoveryService({
      engine: () => null,
      settings: settingsWith(),
      secrets: noKeys,
    });
    expect(await none.search({ keywords: ["x"], locations: [] })).toEqual({
      ok: false,
      code: "engine-unavailable",
    });
    const gone = createDiscoveryService({
      engine: () =>
        engineAnswering(async () => {
          throw new EngineUnavailableError("crashed");
        }),
      settings: settingsWith(),
      secrets: noKeys,
    });
    expect(await gone.search({ keywords: ["x"], locations: [] })).toEqual({
      ok: false,
      code: "engine-unavailable",
    });
  });

  it("reports any other failure as a search failure, without the error text", async () => {
    const service = createDiscoveryService({
      engine: () =>
        engineAnswering(async () => {
          throw new Error("secret detail");
        }),
      settings: settingsWith(),
      secrets: noKeys,
    });

    const result = await service.search({ keywords: ["x"], locations: [] });

    expect(result).toEqual({ ok: false, code: "search-failed" });
    expect(JSON.stringify(result)).not.toContain("secret detail");
  });
});
