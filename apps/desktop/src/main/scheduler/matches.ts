import type { JobFilter, JobListItem } from "@job-finder/bridge";

/** The new jobs of one run that match the profile. */
export interface NewJobMatches {
  /** Distinct jobs. */
  count: number;
  /** The highest affinity score among them, or null when none is scored. */
  topScore: number | null;
}

/** Lists open jobs for a filter, newest first, with `firstSeenAt` and `score` filled in. */
export type ListJobs = (filter: JobFilter) => Promise<JobListItem[]>;

/**
 * The jobs first seen at or after `since` that match the filter. Reads the job list through
 * `listJobs`, so it needs no database here.
 */
export async function findNewMatches(
  filter: JobFilter,
  since: number,
  listJobs: ListJobs,
): Promise<NewJobMatches> {
  const fresh = (await listJobs(filter)).filter((item) => item.firstSeenAt >= since);
  const scores = fresh.map((item) => item.score).filter((score): score is number => score !== null);
  return {
    count: fresh.length,
    topScore: scores.length > 0 ? Math.max(...scores) : null,
  };
}
