import { z } from "zod";
import { buildJob, locationsFromText } from "../ats/build";
import { htmlToText, resolvePlace, type NormalizedJob } from "../normalize";
import { jobMatchesPlaces } from "./place-match";
import type { SearchOptions } from "./source";
import type { DiscoveryCriteria } from "./types";

/**
 * Postings of public job APIs that need no key, kept as jobs: each names its company, its place or
 * the countries a remote posting is open to, and carries the full text. Only postings in the
 * criteria's places are kept.
 */
const HIMALAYAS = "https://himalayas.app/jobs/api";
const ARBEITNOW = "https://www.arbeitnow.com/api/job-board-api";

const HIMALAYAS_PAGES = 15;
const HIMALAYAS_PAGE_SIZE = 20;
const ARBEITNOW_PAGES = 3;
const MAX_DESCRIPTION_CHARS = 8_000;

const HimalayasPage = z.object({ jobs: z.array(z.unknown()) });
const HimalayasJob = z.object({
  title: z.string().min(1),
  companyName: z.string().min(1),
  employmentType: z.string().nullish(),
  seniority: z.array(z.string()).nullish(),
  locationRestrictions: z.array(z.string()).nullish(),
  description: z.string().nullish(),
  pubDate: z.union([z.number(), z.string()]).nullish(),
  applicationLink: z.string().nullish(),
  guid: z.string().nullish(),
});

const ArbeitnowPage = z.object({ data: z.array(z.unknown()) });
const ArbeitnowJob = z.object({
  slug: z.string(),
  company_name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullish(),
  remote: z.boolean().nullish(),
  url: z.string(),
  location: z.string().nullish(),
  created_at: z.union([z.number(), z.string()]).nullish(),
});

function isoFrom(value: number | string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const number = Number(value);
  if (Number.isFinite(number) && number > 1e9) return new Date(number * 1000).toISOString();
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

async function readJson(url: string, options: SearchOptions): Promise<unknown> {
  const answer = await options.http.get(url, { signal: options.signal });
  if (!answer.ok) return undefined;
  try {
    return JSON.parse(answer.body);
  } catch {
    return undefined;
  }
}

/** The English names of the single countries among the places. */
function countryNames(places: readonly string[]): string[] {
  const names = new Set<string>();
  for (const place of places) {
    const resolved = resolvePlace(place);
    if (resolved.kind !== "countries" || resolved.codes.length !== 1) continue;
    const name = new Intl.DisplayNames(["en"], { type: "region" }).of(resolved.codes[0] as string);
    if (name) names.add(name);
  }
  return [...names];
}

/** Himalayas: remote postings open to a country, with the restrictions it states. */
export async function himalayasJobs(
  criteria: DiscoveryCriteria,
  options: SearchOptions,
): Promise<NormalizedJob[]> {
  const jobs = new Map<string, NormalizedJob>();
  for (const country of countryNames(criteria.locations)) {
    for (let page = 0; page < HIMALAYAS_PAGES; page += 1) {
      if (options.signal?.aborted) return [...jobs.values()];
      const params = new URLSearchParams({
        country,
        limit: String(HIMALAYAS_PAGE_SIZE),
        offset: String(page * HIMALAYAS_PAGE_SIZE),
      });
      const data = HimalayasPage.safeParse(await readJson(`${HIMALAYAS}?${params}`, options));
      if (!data.success || data.data.jobs.length === 0) break;
      for (const item of data.data.jobs) {
        const raw = HimalayasJob.safeParse(item);
        const link = raw.success ? (raw.data.applicationLink ?? raw.data.guid) : undefined;
        if (!raw.success || !link) continue;
        const restrictions = raw.data.locationRestrictions ?? [];
        const job = buildJob({
          source: "himalayas",
          sourceJobId: raw.data.guid ?? link,
          url: link,
          companyName: raw.data.companyName,
          title: raw.data.title,
          description: htmlToText(raw.data.description ?? "").slice(0, MAX_DESCRIPTION_CHARS),
          locations: locationsFromText([
            // A long list of countries is a posting open almost everywhere: the list is not shown.
            restrictions.length > 0 && restrictions.length <= 8
              ? `Remote - ${restrictions.join(", ")}`
              : "Remote",
          ]),
          workModeHints: ["remote"],
          employmentLabel: raw.data.employmentType ?? undefined,
          seniorityLabel: raw.data.seniority?.join(" "),
          postedAt: isoFrom(raw.data.pubDate),
        });
        if (jobMatchesPlaces(job, criteria.locations, { remoteWithoutScope: true })) {
          jobs.set(job.sourceJobId, job);
        }
      }
    }
  }
  return [...jobs.values()];
}

/** Arbeitnow: postings of Germany and its neighbours, on site and remote. */
export async function arbeitnowJobs(
  criteria: DiscoveryCriteria,
  options: SearchOptions,
): Promise<NormalizedJob[]> {
  if (criteria.locations.length === 0) return [];
  const jobs = new Map<string, NormalizedJob>();
  for (let page = 1; page <= ARBEITNOW_PAGES; page += 1) {
    if (options.signal?.aborted) break;
    const data = ArbeitnowPage.safeParse(await readJson(`${ARBEITNOW}?page=${page}`, options));
    if (!data.success || data.data.data.length === 0) break;
    for (const item of data.data.data) {
      const raw = ArbeitnowJob.safeParse(item);
      if (!raw.success) continue;
      const job = buildJob({
        source: "arbeitnow",
        sourceJobId: raw.data.slug,
        url: raw.data.url,
        companyName: raw.data.company_name,
        title: raw.data.title,
        description: htmlToText(raw.data.description ?? "").slice(0, MAX_DESCRIPTION_CHARS),
        locations: locationsFromText([
          raw.data.remote ? `Remote - ${raw.data.location ?? ""}`.trim() : raw.data.location,
        ]),
        workModeHints: [raw.data.remote ? "remote" : undefined],
        postedAt: isoFrom(raw.data.created_at),
      });
      if (jobMatchesPlaces(job, criteria.locations, { remoteWithoutScope: false })) {
        jobs.set(job.sourceJobId, job);
      }
    }
  }
  return [...jobs.values()];
}
