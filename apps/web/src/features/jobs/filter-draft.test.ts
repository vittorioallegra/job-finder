// protects=the filter form turns its values into a valid job filter and back, drops empty text, refuses a number or code the schema rejects, and toggles list entries without changing the others;
// fails_when=an empty form narrows results, a salary with no amount is kept, an invalid minimum score is turned into a filter, a country code is not upper case, a round trip loses a value, or toggling removes another entry;
// no_claim=the rendering of the form and its labels are not covered here; the jobs screen tests check the form on the page;
import { describe, expect, it } from "vitest";
import { JobFilterSchema } from "@job-finder/bridge";
import { draftFromFilter, EMPTY_DRAFT, filterFromDraft, splitTerms, toggle } from "./filter-draft";

describe("filter draft", () => {
  it("turns an empty draft into the filter that narrows nothing", () => {
    expect(filterFromDraft(EMPTY_DRAFT)).toEqual({ ok: true, filter: JobFilterSchema.parse({}) });
  });

  it("reads comma-separated keywords and drops empty entries", () => {
    expect(splitTerms(" backend, , go ,")).toEqual(["backend", "go"]);
    const result = filterFromDraft({ ...EMPTY_DRAFT, keywords: "backend, go", countryCode: "it" });
    expect(result).toMatchObject({
      ok: true,
      filter: { keywords: ["backend", "go"], countryCode: "IT" },
    });
  });

  it("sets a salary only when a minimum is typed, in the chosen currency and period", () => {
    const result = filterFromDraft({
      ...EMPTY_DRAFT,
      salaryMin: "60000",
      salaryCurrency: "USD",
      salaryPeriod: "month",
      salaryHideWithout: true,
    });
    expect(result).toMatchObject({
      ok: true,
      filter: { salary: { min: 60000, currency: "USD", period: "month", hideWithoutSalary: true } },
    });
    expect(filterFromDraft({ ...EMPTY_DRAFT, salaryMin: "  " })).toMatchObject({
      ok: true,
      filter: { salary: null },
    });
  });

  it("refuses a minimum score that is not a number or is out of range, and a salary that is not a number", () => {
    expect(filterFromDraft({ ...EMPTY_DRAFT, minScore: "high" })).toEqual({ ok: false });
    expect(filterFromDraft({ ...EMPTY_DRAFT, minScore: "101" })).toEqual({ ok: false });
    expect(filterFromDraft({ ...EMPTY_DRAFT, salaryMin: "lots" })).toEqual({ ok: false });
  });

  it("keeps every value through a round trip from a filter to the draft and back", () => {
    const filter = JobFilterSchema.parse({
      keywords: ["backend", "go"],
      excludedKeywords: ["php"],
      locationText: "Milan",
      countryCode: "IT",
      remoteScope: "EU",
      workModes: ["hybrid", "remote"],
      employmentTypes: ["full_time"],
      seniorities: ["senior"],
      salary: { min: 50000, currency: "EUR", period: "year", hideWithoutSalary: false },
      postedWithin: "7d",
      language: "en",
      visaSponsorship: "yes",
      includedCompanyIds: ["c1"],
      excludedCompanyIds: ["c2"],
      sources: ["greenhouse"],
      minScore: 60,
      hideDismissed: false,
      hideApplied: false,
      newOnly: true,
    });

    expect(filterFromDraft(draftFromFilter(filter))).toEqual({ ok: true, filter });
  });

  it("adds an entry that is absent and removes one that is present, leaving the rest", () => {
    expect(toggle(["remote"], "hybrid")).toEqual(["remote", "hybrid"]);
    expect(toggle(["remote", "hybrid"], "remote")).toEqual(["hybrid"]);
  });
});
