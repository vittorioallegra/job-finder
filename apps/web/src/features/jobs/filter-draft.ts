import {
  DEFAULT_JOB_FILTER,
  JobFilterSchema,
  type JobFilter,
  type PostedWithin,
} from "@job-finder/bridge";

type FilterSalaryPeriod = NonNullable<JobFilter["salary"]>["period"];
type FilterVisa = NonNullable<JobFilter["visaSponsorship"]>;

/**
 * The filter form's values as the user types them. Text stays text until it is turned into a
 * `JobFilter`, so an invalid number or code is reported by the form instead of being dropped.
 */
export interface FilterDraft {
  keywords: string;
  excludedKeywords: string;
  locationText: string;
  countryCode: string;
  remoteScope: string;
  workModes: string[];
  employmentTypes: string[];
  seniorities: string[];
  /** Empty: no salary condition. */
  salaryMin: string;
  salaryCurrency: string;
  salaryPeriod: FilterSalaryPeriod;
  salaryHideWithout: boolean;
  postedWithin: PostedWithin;
  language: string;
  visaSponsorship: "" | FilterVisa;
  includedCompanyIds: string[];
  excludedCompanyIds: string[];
  sources: string[];
  minScore: string;
  hideDismissed: boolean;
  newOnly: boolean;
}

export const SALARY_CURRENCIES = ["EUR", "USD", "GBP", "CHF"] as const;

export const EMPTY_DRAFT: FilterDraft = draftFromFilter(DEFAULT_JOB_FILTER);

/** Splits a comma-separated list, dropping empty entries. */
export function splitTerms(text: string): string[] {
  return text
    .split(",")
    .map((term) => term.trim())
    .filter((term) => term !== "");
}

/** The list with `value` added when absent, removed when present. */
export function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function draftFromFilter(filter: JobFilter): FilterDraft {
  return {
    keywords: filter.keywords.join(", "),
    excludedKeywords: filter.excludedKeywords.join(", "),
    locationText: filter.locationText,
    countryCode: filter.countryCode ?? "",
    remoteScope: filter.remoteScope,
    workModes: [...filter.workModes],
    employmentTypes: [...filter.employmentTypes],
    seniorities: [...filter.seniorities],
    salaryMin: filter.salary === null ? "" : String(filter.salary.min),
    salaryCurrency: filter.salary?.currency ?? "EUR",
    salaryPeriod: filter.salary?.period ?? "year",
    salaryHideWithout: filter.salary?.hideWithoutSalary ?? false,
    postedWithin: filter.postedWithin,
    language: filter.language ?? "",
    visaSponsorship: filter.visaSponsorship ?? "",
    includedCompanyIds: [...filter.includedCompanyIds],
    excludedCompanyIds: [...filter.excludedCompanyIds],
    sources: [...filter.sources],
    minScore: filter.minScore === null ? "" : String(filter.minScore),
    hideDismissed: filter.hideDismissed,
    newOnly: filter.newOnly,
  };
}

/** The filter the draft describes, or the name of the first value the schema refuses. */
export function filterFromDraft(
  draft: FilterDraft,
): { ok: true; filter: JobFilter } | { ok: false } {
  const salaryMin = draft.salaryMin.trim();
  const parsed = JobFilterSchema.safeParse({
    keywords: splitTerms(draft.keywords),
    excludedKeywords: splitTerms(draft.excludedKeywords),
    locationText: draft.locationText.trim(),
    countryCode: draft.countryCode.trim() === "" ? null : draft.countryCode.trim().toUpperCase(),
    remoteScope: draft.remoteScope.trim(),
    workModes: draft.workModes,
    employmentTypes: draft.employmentTypes,
    seniorities: draft.seniorities,
    salary:
      salaryMin === ""
        ? null
        : {
            min: Number(salaryMin),
            currency: draft.salaryCurrency,
            period: draft.salaryPeriod,
            hideWithoutSalary: draft.salaryHideWithout,
          },
    postedWithin: draft.postedWithin,
    language: draft.language.trim() === "" ? null : draft.language.trim().toLowerCase(),
    visaSponsorship: draft.visaSponsorship === "" ? null : draft.visaSponsorship,
    includedCompanyIds: draft.includedCompanyIds,
    excludedCompanyIds: draft.excludedCompanyIds,
    sources: draft.sources,
    minScore: draft.minScore.trim() === "" ? null : Number(draft.minScore),
    hideDismissed: draft.hideDismissed,
    newOnly: draft.newOnly,
  });
  return parsed.success ? { ok: true, filter: parsed.data } : { ok: false };
}
