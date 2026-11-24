// protects=the job filter has a default that narrows nothing, rejects values outside its typed options and unknown keys, drops the score and new-only conditions for scoring, and computes the posted-within cut-off from the given time;
// fails_when=an empty filter narrows results, an unknown work mode or key is accepted, a keyword list over its limit is accepted, scoring keeps the minimum score or the new-only condition, or a posted-within window is computed from another time;
// no_claim=the SQL that applies a filter is not covered here; the desktop filter tests run it over a SQLite database;
import { describe, expect, it } from "vitest";
import { DEFAULT_JOB_FILTER, hardFilter, JobFilterSchema, postedSince } from "./schema";

describe("job filter schema", () => {
  it("parses an empty object to a filter that narrows nothing and hides dismissed jobs", () => {
    expect(DEFAULT_JOB_FILTER).toEqual({
      roles: [],
      keywords: [],
      excludedKeywords: [],
      locationText: "",
      countryCode: null,
      remoteScope: "",
      workModes: [],
      employmentTypes: [],
      seniorities: [],
      salary: null,
      postedWithin: "any",
      language: null,
      visaSponsorship: null,
      includedCompanyIds: [],
      excludedCompanyIds: [],
      sources: [],
      minScore: null,
      hideDismissed: true,
      hideApplied: true,
      newOnly: false,
    });
  });

  it("rejects an unknown work mode, an unknown key, a country code that is not two capitals, and more keywords than the limit", () => {
    expect(JobFilterSchema.safeParse({ workModes: ["bogus"] }).success).toBe(false);
    expect(JobFilterSchema.safeParse({ colour: "red" }).success).toBe(false);
    expect(JobFilterSchema.safeParse({ countryCode: "italy" }).success).toBe(false);
    expect(
      JobFilterSchema.safeParse({ keywords: Array.from({ length: 11 }, (_, i) => `k${i}`) })
        .success,
    ).toBe(false);
  });

  it("keeps the hard filters for scoring and drops the score and new-only conditions", () => {
    const filter = JobFilterSchema.parse({
      keywords: ["backend"],
      minScore: 70,
      newOnly: true,
      hideDismissed: false,
    });

    expect(hardFilter(filter)).toMatchObject({
      keywords: ["backend"],
      minScore: null,
      newOnly: false,
      hideDismissed: false,
    });
  });

  it("computes the posted-within cut-off from the given time, and none for any", () => {
    const now = Date.UTC(2026, 10, 23);

    expect(postedSince("any", now)).toBeNull();
    expect(postedSince("24h", now)).toBe(now - 24 * 60 * 60 * 1000);
    expect(postedSince("7d", now)).toBe(now - 7 * 24 * 60 * 60 * 1000);
    expect(postedSince("30d", now)).toBe(now - 30 * 24 * 60 * 60 * 1000);
  });
});
