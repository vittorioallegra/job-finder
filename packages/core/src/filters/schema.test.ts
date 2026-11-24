// protects=the job filter has a default that narrows nothing, rejects values outside its typed options and unknown keys, and drops the new-only condition for scoring;
// fails_when=an empty filter narrows results, an unknown work mode or key is accepted, a role list over its limit is accepted, or scoring keeps the new-only condition;
// no_claim=the SQL that applies a filter is not covered here; the desktop jobs list tests run it over a SQLite database;
import { describe, expect, it } from "vitest";
import { DEFAULT_JOB_FILTER, hardFilter, JobFilterSchema } from "./schema";

describe("job filter schema", () => {
  it("parses an empty object to a filter that narrows nothing and hides dismissed jobs", () => {
    expect(DEFAULT_JOB_FILTER).toEqual({
      roles: [],
      places: [],
      workModes: [],
      employmentTypes: [],
      hideDismissed: true,
      hideApplied: true,
      newOnly: false,
    });
  });

  it("rejects an unknown work mode, an unknown key, and more roles than the limit", () => {
    expect(JobFilterSchema.safeParse({ workModes: ["bogus"] }).success).toBe(false);
    expect(JobFilterSchema.safeParse({ colour: "red" }).success).toBe(false);
    expect(
      JobFilterSchema.safeParse({ roles: Array.from({ length: 11 }, (_, i) => `r${i}`) }).success,
    ).toBe(false);
  });

  it("keeps the other conditions for scoring and drops the new-only one", () => {
    const filter = JobFilterSchema.parse({
      roles: ["backend"],
      newOnly: true,
      hideDismissed: false,
    });

    expect(hardFilter(filter)).toMatchObject({
      roles: ["backend"],
      newOnly: false,
      hideDismissed: false,
    });
  });
});
