import { z } from "zod";
import { htmlToText, locationFromParts, type JobLocation } from "../normalize";
import { createAdapter } from "./adapter";
import { buildJob, companyOf, parseJson, toIso } from "./build";

// Account widget API used by the careers page: apply.workable.com/api/v1/widget/accounts/<slug>
// It is not documented as a public API, so the shape is checked on every read.
const place = z.object({
  city: z.string().nullish(),
  state: z.string().nullish(),
  country: z.string().nullish(),
  countryCode: z.string().nullish(),
  country_code: z.string().nullish(),
  hidden: z.boolean().nullish(),
});

const schema = z.object({
  name: z.string().nullish(),
  jobs: z.array(
    z.object({
      shortcode: z.string(),
      title: z.string(),
      url: z.string(),
      application_url: z.string().nullish(),
      department: z.string().nullish(),
      employment_type: z.string().nullish(),
      telecommuting: z.boolean().nullish(),
      published_on: z.string().nullish(),
      created_at: z.string().nullish(),
      description: z.string().nullish(),
      country: z.string().nullish(),
      country_code: z.string().nullish(),
      city: z.string().nullish(),
      state: z.string().nullish(),
      locations: z.array(place).nullish(),
    }),
  ),
});

export const workable = createAdapter({
  id: "workable",
  endpoint: (slug) => `https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`,
  parse: (body, board) => {
    const data = parseJson(body, schema);
    if (!data) return undefined;
    return {
      jobs: data.jobs.map((job) => {
        const visible = (job.locations ?? []).filter((item) => item.hidden !== true);
        const places =
          visible.length > 0
            ? visible
            : [
                {
                  city: job.city,
                  state: job.state,
                  country: job.country,
                  countryCode: job.country_code,
                },
              ];
        const locations = places
          .map((item) =>
            locationFromParts({
              city: item.city,
              region: item.state,
              country: item.country,
              countryCode: item.countryCode ?? item.country_code,
            }),
          )
          .filter((location): location is JobLocation => location !== undefined);
        return buildJob({
          source: "workable",
          sourceJobId: job.shortcode,
          url: job.url,
          applyUrl: job.application_url ?? job.url,
          companyName: companyOf(board, data.name),
          title: job.title,
          description: htmlToText(job.description ?? ""),
          locations,
          workModeHints: [job.telecommuting === true ? "remote" : undefined],
          employmentLabel: job.employment_type ?? undefined,
          postedAt: toIso(job.published_on ?? job.created_at),
        });
      }),
    };
  },
});
