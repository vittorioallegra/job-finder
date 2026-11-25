import { getAdapter } from "../ats";
import type { AtsId } from "../ats/types";
import type { NormalizedJob } from "../normalize";
import { jobMatchesPlaces } from "./place-match";
import type { SearchOptions } from "./source";
import type { DiscoveryCriteria } from "./types";

/**
 * Board names of the companies on the three largest public job APIs, kept by a community project
 * (job-board-aggregator by Feashliaa, rebuilt daily from Common Crawl; the lists are licensed
 * CC BY-NC 4.0, for non-commercial use). A name may be stale or wrong: the board read says so.
 */
const LIST_BASE = "https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/main/data";
export const WIDE_LISTS: readonly { ats: AtsId; file: string }[] = [
  { ats: "greenhouse", file: "greenhouse_companies.json" },
  { ats: "lever", file: "lever_companies.json" },
  { ats: "ashby", file: "ashby_companies.json" },
];

/** Boards read in one wide scan. */
export const WIDE_SLICE = 1200;
const AT_ONCE = 8;

export interface WideBoard {
  ats: AtsId;
  slug: string;
}

/** The board names of every list, one list after another; undefined when none could be read. */
export async function wideBoards(options: SearchOptions): Promise<WideBoard[] | undefined> {
  const boards: WideBoard[] = [];
  let read = 0;
  for (const list of WIDE_LISTS) {
    if (options.signal?.aborted) break;
    const answer = await options.http.get(`${LIST_BASE}/${list.file}`, {
      signal: options.signal,
      maxBodyBytes: 4 * 1024 * 1024,
    });
    if (!answer.ok) continue;
    try {
      const slugs: unknown = JSON.parse(answer.body);
      if (!Array.isArray(slugs)) continue;
      read += 1;
      for (const slug of slugs) {
        if (typeof slug === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug)) {
          boards.push({ ats: list.ats, slug });
        }
      }
    } catch {
      // A list that is not JSON is skipped; the others still count.
    }
  }
  return read === 0 ? undefined : boards;
}

/**
 * Reads a slice of the community board lists and keeps the postings that are in the criteria's
 * places. The slice wraps around the end of the lists, so repeated calls walk all of them.
 * Boards already followed are left to their own scan. A board that fails or is gone gives nothing.
 */
export async function wideScan(
  criteria: DiscoveryCriteria,
  options: SearchOptions,
): Promise<{ jobs: NormalizedJob[]; next: number; boards: number } | undefined> {
  const wide = criteria.wide;
  if (!wide) return undefined;
  const all = await wideBoards(options);
  if (all === undefined || all.length === 0) return undefined;
  const known = new Set(criteria.knownBoards ?? []);
  const start = ((wide.offset % all.length) + all.length) % all.length;
  const count = Math.min(wide.count, all.length);
  const slice = Array.from(
    { length: count },
    (_, index) => all[(start + index) % all.length],
  ).filter(
    (board): board is WideBoard => board !== undefined && !known.has(`${board.ats}/${board.slug}`),
  );

  const jobs: NormalizedJob[] = [];
  for (let from = 0; from < slice.length; from += AT_ONCE) {
    if (options.signal?.aborted) break;
    const batch = slice.slice(from, from + AT_ONCE);
    const results = await Promise.all(
      batch.map((board) =>
        getAdapter(board.ats)
          .fetchJobs({ ats: board.ats, slug: board.slug }, options.http, { signal: options.signal })
          .catch(() => undefined),
      ),
    );
    for (const result of results) {
      if (result?.ok) {
        jobs.push(
          ...result.jobs.filter((job) =>
            jobMatchesPlaces(job, criteria.locations, { remoteWithoutScope: false }),
          ),
        );
      }
    }
  }
  return { jobs, next: (start + count) % all.length, boards: slice.length };
}
