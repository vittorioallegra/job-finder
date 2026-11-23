import { z } from "zod";
import { JOB_SORTS, JobFilterSchema, type JobFilter } from "@job-finder/core/filters";
import type { Salary } from "@job-finder/core/normalize/job";
import type { JobListItem } from "./ingest";

// The renderer imports the filter schema and its option lists from here, never from core directly.
export {
  DEFAULT_JOB_FILTER,
  hardFilter,
  JOB_SORTS,
  JobFilterSchema,
  POSTED_WITHIN_VALUES,
  type JobFilter,
  type JobFilterInput,
  type JobSort,
  type PostedWithin,
} from "@job-finder/core/filters";
export {
  EMPLOYMENT_TYPES,
  SENIORITY_LEVELS,
  VISA_SPONSORSHIP_VALUES,
  WORK_MODES,
  type EmploymentType,
  type Salary,
  type SeniorityLevel,
  type VisaSponsorship,
  type WorkMode,
} from "@job-finder/core/normalize/job";

/** The results of the jobs screen: the filter, and the order to list them in. */
export const JobsListRequestSchema = z.strictObject({
  filter: JobFilterSchema,
  sort: z.enum(JOB_SORTS),
});

export type JobsListRequest = z.input<typeof JobsListRequestSchema>;

const identifier = z.string().min(1).max(64);

export const JobDetailRequestSchema = z.strictObject({ jobId: identifier });

export type JobDetailRequest = z.input<typeof JobDetailRequestSchema>;

/** A flag change: `dismissed` hides or shows the job, `viewed` ends its "new" badge. */
export const JobFlagRequestSchema = z
  .strictObject({
    jobId: identifier,
    dismissed: z.boolean().optional(),
    viewed: z.boolean().optional(),
  })
  .refine((request) => request.dismissed !== undefined || request.viewed !== undefined, {
    message: "A flag change needs dismissed or viewed",
  });

export type JobFlagRequest = z.input<typeof JobFlagRequestSchema>;

/** One source's posting of a job, as the detail view lists them. */
export interface JobSourceLink {
  source: string;
  url: string;
  applyUrl: string;
  /** True once the source no longer lists the posting. */
  closed: boolean;
  /** Epoch milliseconds. */
  lastSeenAt: number;
}

export interface JobDetail extends JobListItem {
  description: string;
  employmentType: string;
  seniority: string;
  salary: Salary | null;
  visaSponsorship: string;
  language: string | null;
  remoteScope: string | null;
  /** Epoch milliseconds, or null when the job is open. */
  closedAt: number | null;
  sources: JobSourceLink[];
}

export const SavedSearchSaveRequestSchema = z.strictObject({
  /** Given: replace that search. Omitted: create one. */
  id: identifier.optional(),
  name: z.string().trim().min(1).max(100),
  filter: JobFilterSchema,
});

export type SavedSearchSaveRequest = z.input<typeof SavedSearchSaveRequestSchema>;

export const SavedSearchDeleteRequestSchema = z.strictObject({ id: identifier });

export type SavedSearchDeleteRequest = z.input<typeof SavedSearchDeleteRequestSchema>;

export interface SavedSearch {
  id: string;
  name: string;
  filter: JobFilter;
  /** Epoch milliseconds. */
  updatedAt: number;
}
