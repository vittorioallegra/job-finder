import { z } from "zod";
import { EMPLOYMENT_TYPES, WORK_MODES } from "../normalize/job";
import type { JobPreferences } from "../profile/schema";

/** Postings older than this are not shown: a posting kept online for a year is rarely still hiring. */
export const MAX_POSTING_AGE_DAYS = 90;

/** Result orders: by affinity (unscored jobs last) or by newest posting first. */
export const JOB_SORTS = ["affinity", "newest"] as const;
export type JobSort = (typeof JOB_SORTS)[number];

const term = z.string().trim().min(1).max(100);

/**
 * The jobs the list shows, as the profile's "what you are looking for" describes them. Every field
 * is optional: an empty value (or the default) does not narrow the results.
 */
export const JobFilterSchema = z.strictObject({
  /**
   * Roles: a job matches when its title names any of them (see `roleTitleTerms`), since a
   * company's board lists every opening, not only the roles looked for.
   */
  roles: z.array(term).max(10).default([]),
  /**
   * Where the person can work: countries, areas such as "EU" or "Europe", and cities. A job matches
   * when it is in one of them, or is remote and open to someone living there (its remote scope
   * names the country, an area containing it, or the world). A remote job limited to other
   * countries is left out; one that states no scope is kept.
   */
  places: z.array(term).max(10).default([]),
  workModes: z.array(z.enum(WORK_MODES)).max(WORK_MODES.length).default([]),
  employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).max(EMPLOYMENT_TYPES.length).default([]),
  hideDismissed: z.boolean().default(true),
  /** Hides jobs with an application that was submitted or ended (see APPLIED_STATUSES). */
  hideApplied: z.boolean().default(true),
  /** Only jobs the user has not opened yet. */
  newOnly: z.boolean().default(false),
  /**
   * Hides jobs posted more than this many days ago (a job with no posting date counts from when it
   * was first seen). 0 narrows nothing.
   */
  maxAgeDays: z.number().int().min(0).max(3650).default(0),
});

export type JobFilter = z.output<typeof JobFilterSchema>;
export type JobFilterInput = z.input<typeof JobFilterSchema>;

export const DEFAULT_JOB_FILTER: JobFilter = JobFilterSchema.parse({});

/**
 * The part of a filter that decides which jobs may be scored. Whether a job is new depends on what
 * the person has opened, not on the job, so it does not narrow scoring.
 */
export function hardFilter(filter: JobFilter): JobFilter {
  return { ...filter, newOnly: false };
}

/** A list the person narrowed also keeps jobs whose posting does not say, so none is hidden for that. */
function withUnknown<T extends string>(chosen: readonly T[]): (T | "unknown")[] {
  return chosen.length === 0 ? [] : [...chosen, "unknown"];
}

/**
 * The filter a profile's preferences give: its roles, places, work modes and contracts. The level
 * is left to the affinity score, which reads the experience.
 */
export function filterFromPreferences(preferences: JobPreferences | null): JobFilter {
  if (preferences === null) return DEFAULT_JOB_FILTER;
  return {
    ...DEFAULT_JOB_FILTER,
    roles: [...preferences.roles],
    places: [...preferences.locations],
    workModes: withUnknown(preferences.workModes),
    employmentTypes: withUnknown(preferences.employmentTypes),
    maxAgeDays: MAX_POSTING_AGE_DAYS,
  };
}
