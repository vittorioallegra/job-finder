import { z } from "zod";
import {
  EMPLOYMENT_TYPES,
  SALARY_PERIODS,
  SENIORITY_LEVELS,
  VISA_SPONSORSHIP_VALUES,
  WORK_MODES,
} from "../normalize/job";

/** Posted-within windows. `any` applies no date condition. */
export const POSTED_WITHIN_VALUES = ["24h", "3d", "7d", "30d", "any"] as const;
export type PostedWithin = (typeof POSTED_WITHIN_VALUES)[number];

/** Result orders: by affinity (unscored jobs last) or by newest posting first. */
export const JOB_SORTS = ["affinity", "newest"] as const;
export type JobSort = (typeof JOB_SORTS)[number];

const POSTED_WITHIN_MS: Record<Exclude<PostedWithin, "any">, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const term = z.string().trim().min(1).max(100);
const identifier = z.string().min(1).max(64);

/**
 * A minimum salary. It is compared only with salaries stated in the same currency and period; other
 * salaries cannot be compared (no exchange rates), so they are kept unless `hideWithoutSalary` is set.
 */
export const SalaryFilterSchema = z.strictObject({
  min: z.number().nonnegative().max(100_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/),
  period: z.enum(SALARY_PERIODS),
  hideWithoutSalary: z.boolean(),
});

/**
 * The typed filter of the jobs screen and the saved searches. Every field is optional: an empty value
 * (or the default) does not narrow the results. Keywords match when any of them appears in the title
 * or the description; excluded keywords remove a job when any of them appears there.
 */
export const JobFilterSchema = z.strictObject({
  keywords: z.array(term).max(10).default([]),
  excludedKeywords: z.array(term).max(10).default([]),
  /** Matched against the city and region of each location, and the location as written. */
  locationText: z.string().trim().max(100).default(""),
  /** ISO 3166-1 alpha-2, upper case. */
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable()
    .default(null),
  /** Text the remote scope must contain, e.g. "EU". */
  remoteScope: z.string().trim().max(100).default(""),
  workModes: z.array(z.enum(WORK_MODES)).max(WORK_MODES.length).default([]),
  employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).max(EMPLOYMENT_TYPES.length).default([]),
  seniorities: z.array(z.enum(SENIORITY_LEVELS)).max(SENIORITY_LEVELS.length).default([]),
  salary: SalaryFilterSchema.nullable().default(null),
  postedWithin: z.enum(POSTED_WITHIN_VALUES).default("any"),
  /** Two-letter language code of the posting, as the language detector writes it. */
  language: z
    .string()
    .regex(/^[a-z]{2}$/)
    .nullable()
    .default(null),
  visaSponsorship: z.enum(VISA_SPONSORSHIP_VALUES).nullable().default(null),
  /** When not empty, only jobs of these companies. */
  includedCompanyIds: z.array(identifier).max(200).default([]),
  excludedCompanyIds: z.array(identifier).max(200).default([]),
  /** When not empty, only jobs with an open posting from one of these sources (ATS ids). */
  sources: z.array(identifier).max(20).default([]),
  minScore: z.number().int().min(0).max(100).nullable().default(null),
  hideDismissed: z.boolean().default(true),
  /** Only jobs the user has not opened yet. */
  newOnly: z.boolean().default(false),
});

export type JobFilter = z.output<typeof JobFilterSchema>;
export type JobFilterInput = z.input<typeof JobFilterSchema>;

export const DEFAULT_JOB_FILTER: JobFilter = JobFilterSchema.parse({});

/**
 * The hard filters: the part of a filter that decides which jobs may be scored. The minimum score
 * and the new-only view depend on the scores themselves, so they do not narrow scoring.
 */
export function hardFilter(filter: JobFilter): JobFilter {
  return { ...filter, minScore: null, newOnly: false };
}

/** The earliest posting date a filter accepts, in epoch milliseconds, or null for no date condition. */
export function postedSince(postedWithin: PostedWithin, now: number): number | null {
  if (postedWithin === "any") return null;
  return now - POSTED_WITHIN_MS[postedWithin];
}
