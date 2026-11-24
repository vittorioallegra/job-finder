import { DEFAULT_JOB_FILTER, type JobFilter, type JobPreferences } from "@job-finder/bridge";

/** A list the user narrowed also keeps jobs whose posting does not say, so none is hidden for that. */
function withUnknown<T extends string>(chosen: readonly T[]): (T | "unknown")[] {
  return chosen.length === 0 ? [] : [...chosen, "unknown"];
}

/**
 * The filter the jobs list opens with: the profile's work modes, contracts and levels. Roles and
 * places are not filters: they chose which companies to scan, and the affinity score ranks the rest.
 */
export function filterFromPreferences(preferences: JobPreferences | null): JobFilter {
  if (preferences === null) return DEFAULT_JOB_FILTER;
  return {
    ...DEFAULT_JOB_FILTER,
    workModes: withUnknown(preferences.workModes),
    employmentTypes: withUnknown(preferences.employmentTypes),
    seniorities: withUnknown(preferences.seniorities),
  };
}
