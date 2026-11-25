import { z } from "zod";
import { resolvePlace } from "../normalize/geo";
import { normalizeCompanyName } from "./company-name";
import { resolveBoard, type CompanyEntry } from "./resolve-board";
import type { SearchOptions } from "./source";
import type { DiscoveryCandidate, DiscoveryCriteria } from "./types";

/**
 * A job feed names companies that are hiring: a public job API that needs no key. It
 * gives no board to scan, only names (and a job title); `resolveBoard` turns each into a board. A
 * feed's postings are never stored: they only say which companies to read.
 */
export interface JobFeed {
  readonly id: string;
  entries(
    criteria: DiscoveryCriteria,
    options: SearchOptions,
  ): Promise<{ ok: true; entries: CompanyEntry[] } | { ok: false }>;
}

/** Companies looked up per run: guessing a board costs a handful of requests. */
export const MAX_FEED_COMPANIES = 40;

const MAX_KEYWORDS = 3;

async function readJson(
  url: string,
  options: SearchOptions,
  post?: { body: string },
): Promise<unknown | undefined> {
  const answer = post
    ? await options.http.post(url, {
        body: post.body,
        headers: { "content-type": "application/json" },
        signal: options.signal,
      })
    : await options.http.get(url, { signal: options.signal });
  if (!answer.ok) return undefined;
  try {
    return JSON.parse(answer.body);
  } catch {
    return undefined;
  }
}

function keywordsOf(criteria: DiscoveryCriteria): string[] {
  return criteria.keywords
    .map((word) => word.trim())
    .filter((word) => word !== "")
    .slice(0, MAX_KEYWORDS);
}

/** The countries of the places by their English names; empty when the places are cities or areas. */
function countriesOf(criteria: DiscoveryCriteria): { code: string; name: string }[] {
  const found: { code: string; name: string }[] = [];
  for (const place of criteria.locations) {
    const resolved = resolvePlace(place);
    if (resolved.kind !== "countries" || resolved.codes.length !== 1) continue;
    const code = resolved.codes[0] as string;
    const name = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
    if (name && !found.some((country) => country.code === code)) found.push({ code, name });
  }
  return found;
}

const Himalayas = z.object({
  jobs: z.array(z.object({ companyName: z.string(), title: z.string().nullish() })),
});

/** Himalayas: remote jobs, searchable by keyword and country. No key. */
export const himalayasFeed: JobFeed = {
  id: "himalayas",
  async entries(criteria, options) {
    const entries: CompanyEntry[] = [];
    let answered = 0;
    const places = countriesOf(criteria).map((country) => country.name);
    for (const keyword of keywordsOf(criteria)) {
      for (const place of places.length > 0 ? places : [undefined]) {
        const params = new URLSearchParams({ q: keyword, sort: "recent" });
        if (place) params.set("country", place);
        const parsed = Himalayas.safeParse(
          await readJson(`https://himalayas.app/jobs/api/search?${params.toString()}`, options),
        );
        if (!parsed.success) continue;
        answered += 1;
        for (const job of parsed.data.jobs) {
          entries.push({ name: job.companyName, title: job.title ?? null });
        }
      }
    }
    return answered > 0 ? { ok: true, entries } : { ok: false };
  },
};

const Remotive = z.object({
  jobs: z.array(z.object({ company_name: z.string(), title: z.string().nullish() })),
});

/** Remotive: remote jobs, searchable by keyword. No key; the provider asks for few requests. */
export const remotiveFeed: JobFeed = {
  id: "remotive",
  async entries(criteria, options) {
    const entries: CompanyEntry[] = [];
    let answered = 0;
    for (const keyword of keywordsOf(criteria)) {
      const params = new URLSearchParams({ search: keyword, limit: "50" });
      const parsed = Remotive.safeParse(
        await readJson(`https://remotive.com/api/remote-jobs?${params.toString()}`, options),
      );
      if (!parsed.success) continue;
      answered += 1;
      for (const job of parsed.data.jobs) {
        entries.push({ name: job.company_name, title: job.title ?? null });
      }
    }
    return answered > 0 ? { ok: true, entries } : { ok: false };
  },
};

const Arbeitnow = z.object({
  data: z.array(
    z.object({
      company_name: z.string(),
      title: z.string().nullish(),
      location: z.string().nullish(),
    }),
  ),
});

/** Arbeitnow: jobs in Europe, mostly German-speaking. No key. Kept to the places when they are countries. */
export const arbeitnowFeed: JobFeed = {
  id: "arbeitnow",
  async entries(criteria, options) {
    const names = countriesOf(criteria).map((country) => country.name.toLowerCase());
    const entries: CompanyEntry[] = [];
    let answered = 0;
    for (const page of [1, 2]) {
      const parsed = Arbeitnow.safeParse(
        await readJson(`https://www.arbeitnow.com/api/job-board-api?page=${page}`, options),
      );
      if (!parsed.success) continue;
      answered += 1;
      for (const job of parsed.data.data) {
        const where = (job.location ?? "").toLowerCase();
        if (names.length > 0 && !names.some((name) => where.includes(name))) continue;
        entries.push({ name: job.company_name, title: job.title ?? null });
      }
    }
    return answered > 0 ? { ok: true, entries } : { ok: false };
  },
};

/** The feeds that need no key. */
export const KEYLESS_FEEDS: readonly JobFeed[] = [himalayasFeed, remotiveFeed, arbeitnowFeed];

/**
 * Companies named by the feeds, as boards to scan. The feeds are read, their companies listed once
 * each (the feeds take turns, so none crowds the others out), and the first `MAX_FEED_COMPANIES`
 * are looked up. `answered` counts the feeds that gave something.
 */
export async function discoverFromFeeds(
  criteria: DiscoveryCriteria,
  feeds: readonly JobFeed[],
  options: SearchOptions,
): Promise<{ candidates: DiscoveryCandidate[]; answered: number }> {
  const lists: CompanyEntry[][] = [];
  let answered = 0;
  for (const feed of feeds) {
    if (options.signal?.aborted) break;
    const result = await feed.entries(criteria, options).catch(() => ({ ok: false as const }));
    if (!result.ok) continue;
    answered += 1;
    lists.push(result.entries);
  }

  const chosen: CompanyEntry[] = [];
  const seen = new Set<string>();
  for (let round = 0; chosen.length < MAX_FEED_COMPANIES; round += 1) {
    let any = false;
    for (const list of lists) {
      const entry = list[round];
      if (!entry) continue;
      any = true;
      const key = normalizeCompanyName(entry.name);
      if (key === "" || seen.has(key)) continue;
      seen.add(key);
      chosen.push(entry);
      if (chosen.length >= MAX_FEED_COMPANIES) break;
    }
    if (!any) break;
  }

  const candidates: DiscoveryCandidate[] = [];
  for (const entry of chosen) {
    if (options.signal?.aborted) break;
    const candidate = await resolveBoard(entry, options);
    if (candidate) candidates.push(candidate);
  }
  return { candidates, answered };
}
