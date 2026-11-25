import { z } from "zod";
import { buildJob, locationsFromText } from "../ats/build";
import { foldForMatch, htmlToText, resolvePlace, type NormalizedJob } from "../normalize";
import { jobMatchesPlaces } from "./place-match";
import type { SearchOptions } from "./source";
import type { DiscoveryCriteria } from "./types";

/**
 * Workday career sites, read through the JSON the sites' own pages use (`/wday/cxs`). A board is
 * written "tenant|wdN|site" in the community list. A site is searched for each country of the
 * places, the postings that name the place are read for their text, and only those in the places
 * are kept. A site with no posting there costs one request.
 */
export const WORKDAY_SOURCE = "workday";

const PAGE = 20;
const MAX_PAGES = 3;
const MAX_DETAILS = 25;
const MAX_DESCRIPTION_CHARS = 8_000;
const PART = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const Listing = z.object({
  total: z.number().optional(),
  jobPostings: z
    .array(
      z.object({
        title: z.string().optional(),
        externalPath: z.string().optional(),
        locationsText: z.string().nullish(),
      }),
    )
    .default([]),
});

const Detail = z.object({
  jobPostingInfo: z.object({
    title: z.string().min(1),
    jobDescription: z.string().nullish(),
    location: z.string().nullish(),
    additionalLocations: z.array(z.string()).nullish(),
    startDate: z.string().nullish(),
    timeType: z.string().nullish(),
    remoteType: z.string().nullish(),
    jobReqId: z.string().nullish(),
    externalUrl: z.string().nullish(),
    country: z.object({ descriptor: z.string().nullish() }).nullish(),
  }),
});

export function parseWorkdayBoard(
  entry: string,
): { tenant: string; wd: string; site: string } | undefined {
  const [tenant, wd, site, ...rest] = entry.split("|");
  if (!tenant || !wd || !site || rest.length > 0) return undefined;
  if (![tenant, wd, site].every((part) => PART.test(part))) return undefined;
  return { tenant, wd, site };
}

/** "marvell" -> "Marvell": a Workday tenant name is the company's name written in lower case. */
function companyName(tenant: string): string {
  const words = tenant.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Search words and the text a posting's place must contain, from the criteria's places. */
function placeTerms(places: readonly string[]): string[] {
  const terms = new Set<string>();
  for (const place of places) {
    const resolved = resolvePlace(place);
    if (resolved.kind === "countries" && resolved.codes.length === 1) {
      const name = new Intl.DisplayNames(["en"], { type: "region" }).of(
        resolved.codes[0] as string,
      );
      if (name) terms.add(name);
    } else if (resolved.kind === "text" && resolved.text !== "") terms.add(resolved.text);
  }
  return [...terms].slice(0, 3);
}

export async function workdayJobs(
  entry: string,
  criteria: DiscoveryCriteria,
  options: SearchOptions,
): Promise<NormalizedJob[]> {
  const board = parseWorkdayBoard(entry);
  if (!board) return [];
  const base = `https://${board.tenant}.${board.wd}.myworkdayjobs.com/wday/cxs/${board.tenant}/${board.site}`;
  const terms = placeTerms(criteria.locations);
  if (terms.length === 0) return [];

  // Postings that name a place, or several ("3 Locations") that the posting page then settles.
  const found = new Map<string, string | null | undefined>();
  for (const term of terms) {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      if (options.signal?.aborted) return [];
      const answer = await options.http.post(`${base}/jobs`, {
        body: JSON.stringify({
          appliedFacets: {},
          limit: PAGE,
          offset: page * PAGE,
          searchText: term,
        }),
        headers: { "content-type": "application/json" },
        signal: options.signal,
      });
      if (!answer.ok) return [];
      let listing: z.output<typeof Listing>;
      try {
        listing = Listing.parse(JSON.parse(answer.body));
      } catch {
        return [];
      }
      for (const posting of listing.jobPostings) {
        if (!posting.externalPath) continue;
        const text = posting.locationsText ?? "";
        const several = /^\d+\s+locations?$/i.test(text.trim());
        if (several || terms.some((t) => foldForMatch(text).includes(foldForMatch(t)))) {
          found.set(posting.externalPath, text);
        }
      }
      if (listing.jobPostings.length < PAGE) break;
    }
  }

  const jobs: NormalizedJob[] = [];
  for (const path of [...found.keys()].slice(0, MAX_DETAILS)) {
    if (options.signal?.aborted) break;
    const answer = await options.http.get(`${base}${path}`, { signal: options.signal });
    if (!answer.ok) continue;
    let info: z.output<typeof Detail>["jobPostingInfo"];
    try {
      info = Detail.parse(JSON.parse(answer.body)).jobPostingInfo;
    } catch {
      continue;
    }
    const places = [info.location, ...(info.additionalLocations ?? [])].map((place) =>
      [place, info.country?.descriptor].filter(Boolean).join(", "),
    );
    const job = buildJob({
      source: WORKDAY_SOURCE,
      sourceJobId: `${board.tenant}:${info.jobReqId ?? path}`,
      url:
        info.externalUrl ??
        `https://${board.tenant}.${board.wd}.myworkdayjobs.com/${board.site}${path}`,
      companyName: companyName(board.tenant),
      title: info.title,
      description: htmlToText(info.jobDescription ?? "").slice(0, MAX_DESCRIPTION_CHARS),
      locations: locationsFromText(places),
      workModeHints: [info.remoteType ?? undefined],
      employmentLabel: info.timeType ?? undefined,
      postedAt: info.startDate ?? undefined,
    });
    if (jobMatchesPlaces(job, criteria.locations, { remoteWithoutScope: false })) jobs.push(job);
  }
  return jobs;
}
