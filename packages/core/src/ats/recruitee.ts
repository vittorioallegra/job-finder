import { z } from "zod";
import { htmlToText, locationFromParts, normalizeLocation, type JobLocation } from "../normalize";
import { createAdapter } from "./adapter";
import { buildJob, companyOf, parseJson, toIso } from "./build";

// Public offers API: https://<company>.recruitee.com/api/offers/
const schema = z.object({
  offers: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      careers_url: z.string(),
      careers_apply_url: z.string().nullish(),
      company_name: z.string().nullish(),
      location: z.string().nullish(),
      city: z.string().nullish(),
      state_name: z.string().nullish(),
      country: z.string().nullish(),
      country_code: z.string().nullish(),
      remote: z.boolean().nullish(),
      hybrid: z.boolean().nullish(),
      on_site: z.boolean().nullish(),
      employment_type_code: z.string().nullish(),
      experience_code: z.string().nullish(),
      published_at: z.string().nullish(),
      created_at: z.string().nullish(),
      description: z.string().nullish(),
      locations: z
        .array(
          z.object({
            city: z.string().nullish(),
            state: z.string().nullish(),
            country: z.string().nullish(),
            country_code: z.string().nullish(),
          }),
        )
        .nullish(),
    }),
  ),
});

export const recruitee = createAdapter({
  id: "recruitee",
  endpoint: (slug) => `https://${slug}.recruitee.com/api/offers/`,
  parse: (body, board) => {
    const data = parseJson(body, schema);
    if (!data) return undefined;
    return {
      jobs: data.offers.map((offer) => {
        const places = (offer.locations ?? []).map((place) =>
          locationFromParts({
            city: place.city,
            region: place.state,
            country: place.country,
            countryCode: place.country_code,
          }),
        );
        const locations = places.filter((place): place is JobLocation => place !== undefined);
        if (locations.length === 0 && offer.location)
          locations.push(normalizeLocation(offer.location));
        return buildJob({
          source: "recruitee",
          sourceJobId: String(offer.id),
          url: offer.careers_url,
          applyUrl: offer.careers_apply_url ?? offer.careers_url,
          companyName: companyOf(board, offer.company_name),
          title: offer.title,
          description: htmlToText(offer.description ?? ""),
          locations,
          workModeHints: [
            offer.remote === true ? "remote" : undefined,
            offer.hybrid === true ? "hybrid" : undefined,
            offer.on_site === true ? "onsite" : undefined,
          ],
          employmentLabel: offer.employment_type_code ?? undefined,
          seniorityLabel: offer.experience_code ?? undefined,
          postedAt: toIso(offer.published_at ?? offer.created_at),
        });
      }),
    };
  },
});
