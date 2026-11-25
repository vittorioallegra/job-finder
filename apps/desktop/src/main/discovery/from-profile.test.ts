// protects=the company search from the profile uses its roles and places, adds only boards not already listed, and scans only when it added one, and a country is searched by its English name and main city too;
// fails_when=a profile without roles searches anyway, more terms than the search takes are sent, a duplicate board counts as added, a scan starts when nothing was added, or a failed search adds companies;
// no_claim=the search itself and the board detection run in the engine and the repository; scripted stand-ins answer here.
import { describe, expect, it } from "vitest";
import { discoveryRequestFor } from "./from-profile";
import { emptyPreferences, type DiscoverySearchRequest } from "@job-finder/bridge";
import { createProfileDiscovery } from "./from-profile";

const candidate = (slug: string) => ({
  ats: "greenhouse",
  slug,
  careersUrl: `https://boards.greenhouse.io/${slug}`,
  name: slug,
});

describe("company search from the profile", () => {
  it("searches the roles and places, adds the new boards and scans them", async () => {
    const searched: DiscoverySearchRequest[] = [];
    let runs = 0;
    const discovery = createProfileDiscovery({
      preferences: async () => ({
        ...emptyPreferences(),
        roles: ["Backend Engineer", "Tech Lead", "SRE", "Platform", "API", "Data"],
        locations: ["Milano"],
      }),
      search: async (request) => {
        searched.push(request);
        return { ok: true, candidates: [candidate("acme"), candidate("known")] };
      },
      addCompany: async (input) =>
        input.careersUrl.endsWith("known")
          ? { ok: false, code: "duplicate-company" }
          : {
              ok: true,
              company: {
                id: "1",
                name: input.name,
                careersUrl: input.careersUrl,
                ats: "greenhouse",
                slug: "acme",
                createdAt: 0,
              } as never,
            },
      startRun: async () => {
        runs += 1;
        return { ok: true, runId: "run-1" };
      },
    });

    await expect(discovery.run()).resolves.toEqual({
      ok: true,
      found: 2,
      added: 1,
      runStarted: true,
    });
    expect(searched).toEqual([
      {
        keywords: ["Backend Engineer", "Tech Lead", "SRE", "Platform", "API"],
        locations: ["Milano"],
      },
    ]);
    expect(runs).toBe(1);
  });

  it("does nothing without roles, and adds nothing when the search fails or finds only known boards", async () => {
    let added = 0;
    let runs = 0;
    const deps = {
      addCompany: async () => {
        added += 1;
        return { ok: false as const, code: "duplicate-company" as const };
      },
      startRun: async () => {
        runs += 1;
        return { ok: true as const, runId: "run" };
      },
    };
    const noRoles = createProfileDiscovery({
      ...deps,
      preferences: async () => emptyPreferences(),
      search: async () => {
        throw new Error("not reached");
      },
    });
    await expect(noRoles.run()).resolves.toEqual({ ok: false, code: "no-roles" });

    const blocked = createProfileDiscovery({
      ...deps,
      preferences: async () => ({ ...emptyPreferences(), roles: ["Backend Engineer"] }),
      search: async () => ({ ok: false, code: "search-blocked" }),
    });
    await expect(blocked.run()).resolves.toEqual({ ok: false, code: "search-blocked" });
    expect(added).toBe(0);

    const onlyKnown = createProfileDiscovery({
      ...deps,
      preferences: async () => ({ ...emptyPreferences(), roles: ["Backend Engineer"] }),
      search: async () => ({ ok: true, candidates: [candidate("known")] }),
    });
    await expect(onlyKnown.run()).resolves.toEqual({
      ok: true,
      found: 1,
      added: 0,
      runStarted: false,
    });
    expect(runs).toBe(0);
  });

  it("searches a country the way English postings write it, and with its main city, and a city as typed", () => {
    const base = {
      roles: ["Frontend Engineer"],
      workModes: [],
      employmentTypes: [],
      seniorities: [],
    };
    expect(discoveryRequestFor({ ...base, locations: ["Italia"] })).toEqual({
      keywords: ["Frontend Engineer"],
      locations: ["Italia", "Italy", "Milan"],
    });
    // A city, or text that is no country, is searched as typed; an area is not expanded.
    expect(discoveryRequestFor({ ...base, locations: ["Torino", "EU"] })?.locations).toEqual([
      "Torino",
      "EU",
    ]);
    // Never more places than the search takes, and no repeats.
    const many = discoveryRequestFor({
      ...base,
      locations: ["Italia", "Germania", "Francia"],
    });
    expect(many?.locations).toHaveLength(5);
    expect(new Set(many?.locations.map((place) => place.toLowerCase())).size).toBe(5);
  });
});
