import { z } from "zod";
import { buildJob, locationsFromText } from "../ats/build";
import { htmlToText, type NormalizedJob } from "../normalize";
import { isFreshPosting } from "./place-match";
import { directoryPlaces } from "./workable-directory";
import type { SearchOptions } from "./source";
import type { DiscoveryCriteria } from "./types";

/** Source id of postings read from Workable's job directory. */
export const WORKABLE_DIRECTORY_SOURCE = "workable-directory";

const DIRECTORY = "https://jobs.workable.com/api/v1/jobs";

/** Pages (20 postings each) read per place; a country has about two thousand postings. */
const PAGES = 120;
/** Postings kept in one run. */
export const MAX_DIRECTORY_JOBS = 3000;
const MAX_DESCRIPTION_CHARS = 8_000;

const Posting = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string().nullish(),
  requirementsSection: z.string().nullish(),
  employmentType: z.string().nullish(),
  url: z.string(),
  locations: z.array(z.string()).default([]),
  location: z
    .object({
      city: z.string().nullish(),
      subregion: z.string().nullish(),
      countryName: z.string().nullish(),
    })
    .nullish(),
  created: z.string().nullish(),
  workplace: z.string().nullish(),
  company: z.object({ title: z.string() }),
});

const Page = z.object({
  jobs: z.array(z.unknown()),
  nextPageToken: z.string().nullish(),
});

/** One directory posting as a normalized job: the directory states its place and workplace itself. */
export function jobFromDirectory(raw: z.output<typeof Posting>): NormalizedJob {
  const remote = raw.workplace === "remote" || raw.locations.includes("TELECOMMUTE");
  const country = raw.location?.countryName?.trim() || undefined;
  const city = [raw.location?.city, raw.location?.subregion]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(", ");
  const places = remote
    ? [country ? `Remote - ${country}` : "Remote"]
    : [[city, country].filter(Boolean).join(", ")];
  return buildJob({
    source: WORKABLE_DIRECTORY_SOURCE,
    sourceJobId: raw.id,
    url: raw.url,
    companyName: raw.company.title,
    title: raw.title,
    description: htmlToText(`${raw.description ?? ""} ${raw.requirementsSection ?? ""}`).slice(
      0,
      MAX_DESCRIPTION_CHARS,
    ),
    locations: locationsFromText(places),
    workModeHints: [raw.workplace ?? undefined],
    employmentLabel: raw.employmentType ?? undefined,
    postedAt: raw.created ?? undefined,
  });
}

/**
 * Open postings of Workable's public job directory for the criteria's places and keywords, as
 * jobs ready to store: title, description, place and company come with the posting, so no board has
 * to be found first. Empty when the places name no country or city, or the directory fails.
 */
export async function directoryJobs(
  criteria: DiscoveryCriteria,
  options: SearchOptions,
): Promise<NormalizedJob[]> {
  const places = directoryPlaces(criteria.locations);
  if (places.length === 0) return [];
  // Every posting of the place, not only the ones that match a keyword: the lists rank them by
  // affinity, and a posting the keyword misses may still fit.
  const keywords = [""];
  const jobs = new Map<string, NormalizedJob>();

  for (const place of places) {
    for (const keyword of keywords) {
      let token: string | null | undefined;
      for (let page = 0; page < PAGES; page += 1) {
        if (options.signal?.aborted || jobs.size >= MAX_DIRECTORY_JOBS) return [...jobs.values()];
        const params = new URLSearchParams({ location: place });
        if (keyword.trim() !== "") params.set("query", keyword.trim());
        if (token) params.set("pageToken", token);
        const answer = await options.http.get(`${DIRECTORY}?${params.toString()}`, {
          signal: options.signal,
        });
        if (!answer.ok) break;
        let data: z.output<typeof Page>;
        try {
          data = Page.parse(JSON.parse(answer.body));
        } catch {
          break;
        }
        for (const item of data.jobs) {
          const parsed = Posting.safeParse(item);
          if (!parsed.success) continue;
          const job = jobFromDirectory(parsed.data);
          // Workable keeps dead postings online for months: only recent ones are kept.
          if (isFreshPosting(job)) jobs.set(job.sourceJobId, job);
        }
        token = data.nextPageToken;
        if (!token) break;
      }
    }
  }
  return [...jobs.values()];
}
