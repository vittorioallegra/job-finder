// protects=a discovery search is relayed to the engine with the user's terms, and every failure reaches the renderer as a code without the error text;
// fails_when=the terms are changed on the way, a found board is dropped, an unreachable engine is reported as a search failure, or an error message leaks to the renderer;
// no_claim=the engine's requests to the search provider, which the core and engine tests cover, and the IPC payload check, which the handler tests cover.
import { describe, expect, it } from "vitest";
import type { DiscoveryCriteria, DiscoveryOutcome } from "@job-finder/core/discovery/types";
import { EngineUnavailableError } from "../engine/supervisor";
import { createDiscoveryService, type DiscoveryEngine } from "./service";

function engineAnswering(
  answer: () => Promise<DiscoveryOutcome>,
  asked: DiscoveryCriteria[] = [],
): DiscoveryEngine {
  return {
    discoverCompanies: (criteria) => {
      asked.push(criteria);
      return answer();
    },
  };
}

describe("discovery service", () => {
  it("relays the terms to the engine and returns the boards it found", async () => {
    const asked: DiscoveryCriteria[] = [];
    const service = createDiscoveryService(() =>
      engineAnswering(
        async () => ({
          ok: true,
          candidates: [
            {
              ats: "lever",
              slug: "globex",
              careersUrl: "https://jobs.lever.co/globex",
              name: "globex",
            },
          ],
        }),
        asked,
      ),
    );

    const result = await service.search({ keywords: ["data"], locations: ["Milan"] });

    expect(asked).toEqual([{ keywords: ["data"], locations: ["Milan"] }]);
    expect(result).toEqual({
      ok: true,
      candidates: [
        {
          ats: "lever",
          slug: "globex",
          careersUrl: "https://jobs.lever.co/globex",
          name: "globex",
        },
      ],
    });
  });

  it("reports a blocked search as its code", async () => {
    const service = createDiscoveryService(() =>
      engineAnswering(async () => ({ ok: false, code: "search-blocked" })),
    );

    expect(await service.search({ keywords: ["x"], locations: [] })).toEqual({
      ok: false,
      code: "search-blocked",
    });
  });

  it("reports no engine, or an engine that is gone, as engine-unavailable", async () => {
    expect(createDiscoveryService(() => null)).toBeDefined();
    expect(
      await createDiscoveryService(() => null).search({ keywords: ["x"], locations: [] }),
    ).toEqual({
      ok: false,
      code: "engine-unavailable",
    });
    const gone = createDiscoveryService(() =>
      engineAnswering(async () => {
        throw new EngineUnavailableError("crashed");
      }),
    );
    expect(await gone.search({ keywords: ["x"], locations: [] })).toEqual({
      ok: false,
      code: "engine-unavailable",
    });
  });

  it("reports any other failure as a search failure, without the error text", async () => {
    const service = createDiscoveryService(() =>
      engineAnswering(async () => {
        throw new Error("secret detail");
      }),
    );

    const result = await service.search({ keywords: ["x"], locations: [] });

    expect(result).toEqual({ ok: false, code: "search-failed" });
    expect(JSON.stringify(result)).not.toContain("secret detail");
  });
});
