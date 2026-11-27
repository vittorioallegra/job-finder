// protects=a discovery search is relayed to the engine with the user's terms, the enabled sources and only the keyed providers that have a saved key, and every failure reaches the renderer as a code without the error text or a key;
// fails_when=a provider with a saved key is left out, DuckDuckGo is left out, the terms change on the way, a found board is dropped, a keyed provider runs without its toggle or key, a key is returned to the caller, an unreachable engine is reported as a search failure, or an error message leaks to the renderer;
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

    expect(asked[0]?.criteria).toEqual({ keywords: ["data"], locations: ["Milan"], known: [] });
    expect(result).toEqual(found);
  });

  it("passes every provider that has a saved key, one key each, and always keeps DuckDuckGo first", async () => {
    const asked: Asked[] = [];
    const service = createDiscoveryService({
      engine: () => engineAnswering(async () => found, asked),
      settings: settingsWith({ duckduckgo: false }),
      secrets: secretsWith({ "search.tavily": "tavily-key", "search.serper": "serper-key" }),
    });

    await service.search({ keywords: ["x"], locations: [] });

    expect(asked[0]?.config).toEqual({
      duckduckgo: true,
      keyed: [
        { provider: "tavily", apiKey: "tavily-key" },
        { provider: "serper", apiKey: "serper-key" },
      ],
    });
  });

  it("returns a blocked-search note alongside the boards only when no key is in use, and never a key", async () => {
    const withoutKey = createDiscoveryService({
      engine: () => engineAnswering(async () => ({ ...found, searchBlocked: true })),
      settings: settingsWith(),
      secrets: noKeys,
    });
    expect(await withoutKey.search({ keywords: ["x"], locations: [] })).toEqual({
      ...found,
      searchBlocked: true,
    });

    const withKey = createDiscoveryService({
      engine: () => engineAnswering(async () => ({ ...found, searchBlocked: true })),
      settings: settingsWith({ brave: true }),
      secrets: secretsWith({ "search.brave": "brave-secret-value" }),
    });
    const result = await withKey.search({ keywords: ["x"], locations: [] });
    // The results came from the key; the note would wrongly ask for one.
    expect(result).toEqual(found);
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

  it("reads the postings first and then the next slice of the board lists in the background, reports what it stored, and remembers where it stopped", async () => {
    const asked: Asked[] = [];
    const posting = { title: "x" } as never;
    const answers: DiscoveryOutcome[] = [
      { ok: true, candidates: [], jobs: [posting, posting] },
      {
        ok: true,
        candidates: [],
        jobs: [posting],
        wideNext: 2000,
        wideChecked: [{ board: "greenhouse/gone", kind: "dead" }],
      },
    ];
    let cursor = 0;
    const checked: unknown[] = [];
    const seenWhileRunning: boolean[] = [];
    const service = createDiscoveryService({
      engine: () => engineAnswering(async () => answers.shift() as DiscoveryOutcome, asked),
      settings: settingsWith(),
      secrets: noKeys,
      storeJobs: async (jobs) => {
        seenWhileRunning.push(service.status().running);
        return jobs.length;
      },
      wideCursor: { get: async () => cursor, set: async (value) => void (cursor = value) },
      wideChecked: {
        skip: async () => ["greenhouse/old"],
        record: async (e) => void checked.push(...e),
      },
    });

    expect(service.status()).toEqual({ running: false, phase: null, stored: 0 });
    await service.widen({ keywords: ["dev"], locations: ["Italia"] });

    // The age limit of the settings goes with every request.
    expect(asked[0]?.criteria).toMatchObject({ postings: true, maxAgeDays: 30 });
    expect(asked[1]?.criteria).toMatchObject({
      wide: { offset: 0, count: expect.any(Number) },
      skipBoards: ["greenhouse/old"],
    });
    expect(seenWhileRunning).toEqual([true, true]);
    expect(service.status()).toEqual({ running: false, phase: null, stored: 3 });
    expect(cursor).toBe(2000);
    expect(checked).toEqual([{ board: "greenhouse/gone", kind: "dead" }]);

    // A second pass soon after walks the board lists again but does not read the directories again.
    answers.push({ ok: true, candidates: [], wideNext: 4000 });
    await service.widen({ keywords: ["dev"], locations: ["Italia"] });
    expect(asked).toHaveLength(3);
    expect(asked[2]?.criteria).toMatchObject({ wide: { offset: 2000 } });
    expect(cursor).toBe(4000);
  });
});
