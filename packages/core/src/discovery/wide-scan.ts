import { getAdapter } from "../ats";
import type { AtsId } from "../ats/types";
import type { NormalizedJob } from "../normalize";
import { isFreshPosting, jobMatchesPlaces } from "./place-match";
import { workdayBoard } from "./workday";
import type { SearchOptions } from "./source";
import type { DiscoveryCriteria } from "./types";

/**
 * Board names of the companies on the three largest public job APIs, kept by a community project
 * (job-board-aggregator by Feashliaa, rebuilt daily from Common Crawl; the lists are licensed
 * CC BY-NC 4.0, for non-commercial use). A name may be stale or wrong: the board read says so.
 */
const LIST_BASE = "https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/main/data";
export const WIDE_LISTS: readonly { ats: AtsId | "workday"; file: string }[] = [
  { ats: "greenhouse", file: "greenhouse_companies.json" },
  { ats: "lever", file: "lever_companies.json" },
  { ats: "ashby", file: "ashby_companies.json" },
  { ats: "workday", file: "workday_companies.json" },
];

/** Boards read in one wide scan. */
export const WIDE_SLICE = 2000;

export interface WideBoard {
  ats: AtsId | "workday";
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
        if (typeof slug === "string" && /^[A-Za-z0-9][A-Za-z0-9._|-]*$/.test(slug)) {
          boards.push({ ats: list.ats, slug });
        }
      }
    } catch {
      // A list that is not JSON is skipped; the others still count.
    }
  }
  return read === 0 ? undefined : boards;
}

/** Boards read at once per list: the public APIs are limited per host, Workday has a host per site. */
const AT_ONCE_BY_LIST: Record<string, number> = { workday: 32 };
const AT_ONCE_DEFAULT = 10;

export interface WideResult {
  jobs: NormalizedJob[];
  /** Where the next slice starts. */
  next: number;
  boards: number;
  /** Boards found gone ("dead") or with nothing in the places ("idle"). */
  checked: { board: string; kind: "dead" | "idle" }[];
}

/**
 * Reads a slice of the community board lists and keeps the postings that are in the criteria's
 * places. The slice wraps around the end of the lists, so repeated calls walk all of them, and it
 * holds `count` boards that are not followed and not in `skipBoards`. The lists are read at the
 * same time (each at its own pace), so one slow host does not hold the others back. A board that
 * fails for a passing reason gives nothing and is tried again next time.
 */
export async function wideScan(
  criteria: DiscoveryCriteria,
  options: SearchOptions,
): Promise<WideResult | undefined> {
  const wide = criteria.wide;
  if (!wide) return undefined;
  const all = await wideBoards(options);
  if (all === undefined || all.length === 0) return undefined;
  const skip = new Set([...(criteria.knownBoards ?? []), ...(criteria.skipBoards ?? [])]);
  const start = ((wide.offset % all.length) + all.length) % all.length;
  const slice: WideBoard[] = [];
  let steps = 0;
  while (steps < all.length && slice.length < wide.count) {
    const board = all[(start + steps) % all.length];
    steps += 1;
    if (board !== undefined && !skip.has(`${board.ats}/${board.slug}`)) slice.push(board);
  }

  const jobs: NormalizedJob[] = [];
  const checked: WideResult["checked"] = [];
  const pools = new Map<string, WideBoard[]>();
  for (const board of slice) pools.set(board.ats, [...(pools.get(board.ats) ?? []), board]);

  const readBoard = async (board: WideBoard): Promise<void> => {
    const id = `${board.ats}/${board.slug}`;
    try {
      if (board.ats === "workday") {
        const found = await workdayBoard(board.slug, criteria, options);
        jobs.push(...found.jobs);
        if (found.dead) checked.push({ board: id, kind: "dead" });
        else if (found.jobs.length === 0 && !options.signal?.aborted) {
          checked.push({ board: id, kind: "idle" });
        }
        return;
      }
      const result = await getAdapter(board.ats).fetchJobs(
        { ats: board.ats, slug: board.slug },
        options.http,
        { signal: options.signal },
      );
      if (!result.ok) {
        const gone =
          result.code === "board-not-found" ||
          (result.code === "http-status" && result.status === 404);
        if (gone) checked.push({ board: id, kind: "dead" });
        return;
      }
      const kept = result.jobs.filter(
        (job) =>
          isFreshPosting(job) &&
          jobMatchesPlaces(job, criteria.locations, { remoteWithoutScope: false }),
      );
      jobs.push(...kept);
      if (kept.length === 0) checked.push({ board: id, kind: "idle" });
    } catch {
      // A board that throws is tried again next time.
    }
  };

  await Promise.all(
    [...pools.entries()].map(async ([ats, boards]) => {
      const atOnce = AT_ONCE_BY_LIST[ats] ?? AT_ONCE_DEFAULT;
      for (let from = 0; from < boards.length; from += atOnce) {
        if (options.signal?.aborted) return;
        await Promise.all(boards.slice(from, from + atOnce).map(readBoard));
      }
    }),
  );
  return { jobs, next: (start + steps) % all.length, boards: slice.length, checked };
}
