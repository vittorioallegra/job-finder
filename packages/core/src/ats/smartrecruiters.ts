import { z } from "zod";
import { createAdapter, type ParsedPage } from "./adapter";
import { buildJob, companyOf, parseJson, toIso } from "./build";
import { countryCodeFor, locationFromParts } from "../normalize";
import type { BoardRef } from "./types";

// Public postings API: https://developers.smartrecruiters.com/docs/posting-api
const PAGE_SIZE = 100;

const schema = z.object({
  offset: z.number(),
  totalFound: z.number(),
  content: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      visibility: z.string().nullish(),
      releasedDate: z.string().nullish(),
      company: z.object({ name: z.string().nullish() }).nullish(),
      location: z
        .object({
          city: z.string().nullish(),
          region: z.string().nullish(),
          country: z.string().nullish(),
          fullLocation: z.string().nullish(),
          remote: z.boolean().nullish(),
          hybrid: z.boolean().nullish(),
        })
        .nullish(),
      typeOfEmployment: z.object({ label: z.string().nullish() }).nullish(),
      experienceLevel: z.object({ label: z.string().nullish() }).nullish(),
    }),
  ),
});

function endpoint(slug: string, offset = 0): string {
  return `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=${PAGE_SIZE}&offset=${offset}`;
}

function parse(body: string, board: BoardRef): ParsedPage | undefined {
  const data = parseJson(body, schema);
  if (!data) return undefined;
  const next = data.offset + data.content.length;
  // An empty page while more postings are announced is a broken read, never the end of the listing.
  if (data.content.length === 0 && next < data.totalFound) return undefined;
  return {
    jobs: data.content
      .filter((posting) => posting.visibility === undefined || posting.visibility === "PUBLIC")
      .map((posting) => {
        const place = posting.location;
        const location = locationFromParts({
          city: place?.city && countryCodeFor(place.city) === undefined ? place.city : undefined,
          region: place?.region && !/remote|hybrid/i.test(place.region) ? place.region : undefined,
          countryCode: place?.country,
          raw: place?.fullLocation,
        });
        return buildJob({
          source: "smartrecruiters",
          sourceJobId: posting.id,
          url: `https://jobs.smartrecruiters.com/${board.slug}/${posting.id}`,
          companyName: companyOf(board, posting.company?.name),
          title: posting.name,
          // The list endpoint has no description; reading one needs a request per posting.
          description: "",
          locations: location ? [location] : [],
          workModeHints: [
            place?.remote === true ? "remote" : undefined,
            place?.hybrid === true ? "hybrid" : undefined,
          ],
          employmentLabel: posting.typeOfEmployment?.label ?? undefined,
          seniorityLabel: posting.experienceLevel?.label ?? undefined,
          postedAt: toIso(posting.releasedDate),
        });
      }),
    next: next < data.totalFound ? endpoint(board.slug, next) : undefined,
  };
}

export const smartrecruiters = createAdapter({
  id: "smartrecruiters",
  endpoint,
  parse,
});
