import { z } from "zod";
import { htmlToText, type JobLocation } from "../normalize";
import { createAdapter } from "./adapter";
import { buildJob, companyOf, locationsFromText, parseJson, toIso } from "./build";

// Public postings API: https://github.com/lever/postings-api
const schema = z.array(
  z.object({
    id: z.string(),
    text: z.string(),
    hostedUrl: z.string(),
    applyUrl: z.string().nullish(),
    country: z.string().nullish(),
    workplaceType: z.string().nullish(),
    createdAt: z.number().nullish(),
    descriptionPlain: z.string().nullish(),
    description: z.string().nullish(),
    categories: z
      .object({
        location: z.string().nullish(),
        allLocations: z.array(z.string()).nullish(),
        commitment: z.string().nullish(),
      })
      .nullish(),
  }),
);

/** Lever sends the posting country as a code; it fills in locations whose text names no country. */
function withCountry(locations: JobLocation[], country: string | null | undefined): JobLocation[] {
  const code = country?.trim().toUpperCase();
  if (code === undefined || !/^[A-Z]{2}$/.test(code)) return locations;
  if (locations.length === 0) return [{ raw: code, countryCode: code }];
  return locations.map((location) =>
    location.countryCode === undefined ? { ...location, countryCode: code } : location,
  );
}

export const lever = createAdapter({
  id: "lever",
  endpoint: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
  parse: (body, board) => {
    const postings = parseJson(body, schema);
    if (!postings) return undefined;
    return {
      jobs: postings.map((posting) => {
        const categories = posting.categories;
        const locations = locationsFromText(
          categories?.allLocations?.length ? categories.allLocations : [categories?.location],
        );
        return buildJob({
          source: "lever",
          sourceJobId: posting.id,
          url: posting.hostedUrl,
          applyUrl: posting.applyUrl ?? undefined,
          companyName: companyOf(board),
          title: posting.text,
          description: posting.descriptionPlain || htmlToText(posting.description ?? ""),
          locations: withCountry(locations, posting.country),
          workModeHints: [posting.workplaceType ?? undefined],
          employmentLabel: categories?.commitment ?? undefined,
          postedAt: toIso(posting.createdAt),
        });
      }),
    };
  },
});
