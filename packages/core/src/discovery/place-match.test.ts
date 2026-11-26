// protects=a posting is kept for places when a location is in a listed country, a remote scope reaches it, a remote posting names no place, or a city place is found in a location; a posting in another country, or a remote one limited to another, is dropped;
// fails_when=an Italian posting is dropped for Italy, a US-only remote posting is kept, a located posting is read as scope-less remote, or no place keeps everything;
// no_claim=the SQL the jobs list runs, which this mirrors for the wide scan: the two are kept alike by hand;
import { describe, expect, it } from "vitest";
import { normalizeLocation, type NormalizedJob } from "../normalize";
import { isFreshPosting, jobMatchesPlaces } from "./place-match";

const job = (over: Partial<NormalizedJob> & { places?: string[] }): NormalizedJob => ({
  source: "greenhouse",
  sourceJobId: "1",
  url: "https://x.test/1",
  applyUrl: "https://x.test/1",
  companyName: "Acme",
  title: "Engineer",
  description: "",
  locations: (over.places ?? []).map((place) => normalizeLocation(place)),
  workMode: "unknown",
  employmentType: "unknown",
  seniority: "unknown",
  visaSponsorship: "unknown",
  ...over,
});

describe("job places", () => {
  it("keeps a posting located in a listed country and drops one elsewhere", () => {
    expect(jobMatchesPlaces(job({ places: ["Milan, Italy"] }), ["Italia"])).toBe(true);
    expect(jobMatchesPlaces(job({ places: ["Austin, TX, United States"] }), ["Italia"])).toBe(
      false,
    );
  });

  it("reads a US state after a city that exists in Italy as the United States", () => {
    expect(jobMatchesPlaces(job({ places: ["Florence, TX (Onsite)"] }), ["Italia"])).toBe(false);
    expect(jobMatchesPlaces(job({ places: ["Parma, OH"] }), ["Italia"])).toBe(false);
    expect(jobMatchesPlaces(job({ places: ["Florence"] }), ["Italia"])).toBe(true);
  });

  it("keeps a remote posting that names no place or whose scope reaches the country, and drops a closed scope", () => {
    expect(jobMatchesPlaces(job({ workMode: "remote" }), ["Italia"])).toBe(true);
    expect(
      jobMatchesPlaces(job({ workMode: "remote", remoteScope: "Worldwide" }), ["Italia"]),
    ).toBe(true);
    expect(jobMatchesPlaces(job({ workMode: "remote", remoteScope: "EU" }), ["Italia"])).toBe(true);
    expect(jobMatchesPlaces(job({ workMode: "remote", remoteScope: "US" }), ["Italia"])).toBe(
      false,
    );
  });

  it("can drop a remote posting that names neither a place nor a scope", () => {
    expect(
      jobMatchesPlaces(job({ workMode: "remote" }), ["Italia"], { remoteWithoutScope: false }),
    ).toBe(false);
    expect(
      jobMatchesPlaces(job({ workMode: "remote", remoteScope: "Europe" }), ["Italia"], {
        remoteWithoutScope: false,
      }),
    ).toBe(true);
  });

  it("does not read a located posting as scope-less remote", () => {
    expect(
      jobMatchesPlaces(job({ workMode: "remote", places: ["Berlin, Germany"] }), ["Italia"]),
    ).toBe(false);
  });

  it("finds a city place in a location, and keeps everything when no place is given", () => {
    expect(jobMatchesPlaces(job({ places: ["Milan, Italy"] }), ["Milan"])).toBe(true);
    expect(jobMatchesPlaces(job({ places: ["Rome, Italy"] }), ["Milan"])).toBe(false);
    expect(jobMatchesPlaces(job({ places: ["Rome, Italy"] }), [])).toBe(true);
  });

  it("keeps a recent or undated posting and drops one posted long ago", () => {
    const now = Date.parse("2026-11-26T00:00:00Z");
    expect(isFreshPosting(job({ postedAt: "2026-11-01T00:00:00Z" }), now)).toBe(true);
    expect(isFreshPosting(job({ postedAt: "2025-06-13T07:51:32Z" }), now)).toBe(false);
    expect(isFreshPosting(job({}), now)).toBe(true);
    expect(isFreshPosting(job({ postedAt: "not a date" }), now)).toBe(true);
  });
});
