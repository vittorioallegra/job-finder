import { DEFAULT_JOB_FILTER, type JobFilter, type JobPreferences } from "@job-finder/bridge";

/** A list the user narrowed also keeps jobs whose posting does not say, so none is hidden for that. */
function withUnknown<T extends string>(chosen: readonly T[]): (T | "unknown")[] {
  return chosen.length === 0 ? [] : [...chosen, "unknown"];
}

/**
 * The filter the jobs list opens with: the profile's roles (a company's board lists every opening,
 * so the title must name one of them), work modes, contracts and levels. Places chose which
 * companies to scan; the affinity score ranks the rest.
 */
export function filterFromPreferences(preferences: JobPreferences | null): JobFilter {
  if (preferences === null) return DEFAULT_JOB_FILTER;
  return {
    ...DEFAULT_JOB_FILTER,
    roles: [...preferences.roles],
    workModes: withUnknown(preferences.workModes),
    employmentTypes: withUnknown(preferences.employmentTypes),
    seniorities: withUnknown(preferences.seniorities),
  };
}
