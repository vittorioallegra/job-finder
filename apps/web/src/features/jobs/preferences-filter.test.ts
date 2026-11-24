// protects=the jobs list opens with the profile's roles and places, and a list the person narrowed also keeps jobs that do not say;
// fails_when=the places are dropped from the opening filter, or a narrowed work mode hides jobs with an unknown mode;
// no_claim=how the places match jobs in the database is covered by the desktop jobs filter tests;
import { describe, expect, it } from "vitest";
import { DEFAULT_JOB_FILTER } from "@job-finder/bridge";
import { filterFromPreferences } from "./preferences-filter";

describe("filterFromPreferences", () => {
  it("starts from the default filter without preferences", () => {
    expect(filterFromPreferences(null)).toEqual(DEFAULT_JOB_FILTER);
  });

  it("carries the roles and the places, and keeps unknown modes when modes are chosen", () => {
    const filter = filterFromPreferences({
      roles: ["Backend Engineer"],
      locations: ["Italia", "UE"],
      workModes: ["remote"],
      employmentTypes: [],
      seniorities: [],
    });
    expect(filter.roles).toEqual(["Backend Engineer"]);
    expect(filter.places).toEqual(["Italia", "UE"]);
    expect(filter.workModes).toEqual(["remote", "unknown"]);
    expect(filter.employmentTypes).toEqual([]);
  });
});
