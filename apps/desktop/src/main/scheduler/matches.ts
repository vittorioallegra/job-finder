import type { JobFilter, JobListItem, SavedSearch } from "@job-finder/bridge";

/** The new jobs of one run that match at least one saved search. */
export interface NewJobMatches {
  /** Distinct jobs. */
  count: number;
  /** The highest affinity score among them, or null when none is scored. */
  topScore: number | null;
  /** Names of the saved searches that matched, in the order they were given. */
  searchNames: string[];
  /** The one saved search the jobs came from, or null when they came from several. */
  savedSearchId: string | null;
}

/** Lists open jobs for a filter, newest first, with `firstSeenAt` and `score` filled in. */
export type ListJobs = (filter: JobFilter) => Promise<JobListItem[]>;

/**
 * The jobs first seen at or after `since` that match each saved search. A job matching several
 * searches counts once. Reads the job list through `listJobs`, so it needs no database here.
 */
export async function findNewMatches(
  searches: SavedSearch[],
  since: number,
  listJobs: ListJobs,
): Promise<NewJobMatches> {
  const jobs = new Map<string, JobListItem>();
  const matched: SavedSearch[] = [];
  for (const search of searches) {
    const items = await listJobs(search.filter);
    const fresh = items.filter((item) => item.firstSeenAt >= since);
    if (fresh.length > 0) matched.push(search);
    for (const item of fresh) jobs.set(item.id, item);
  }
  const scores = [...jobs.values()]
    .map((item) => item.score)
    .filter((score): score is number => score !== null);
  return {
    count: jobs.size,
    topScore: scores.length > 0 ? Math.max(...scores) : null,
    searchNames: matched.map((search) => search.name),
    savedSearchId: matched.length === 1 && matched[0] ? matched[0].id : null,
  };
}
