import { z } from "zod";
import { createAdapter } from "./adapter";
import { buildJob, companyOf, locationsFromText, parseJson, toIso } from "./build";

// Public job board API: https://developers.ashbyhq.com/docs/public-job-posting-api
const schema = z.object({
  jobs: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      isListed: z.boolean().nullish(),
      location: z.string().nullish(),
      secondaryLocations: z.array(z.object({ location: z.string().nullish() })).nullish(),
      employmentType: z.string().nullish(),
      isRemote: z.boolean().nullish(),
      workplaceType: z.string().nullish(),
      publishedAt: z.string().nullish(),
      jobUrl: z.string(),
      applyUrl: z.string().nullish(),
      descriptionPlain: z.string().nullish(),
    }),
  ),
});

export const ashby = createAdapter({
  id: "ashby",
  endpoint: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
  parse: (body, board) => {
    const data = parseJson(body, schema);
    if (!data) return undefined;
    return {
      jobs: data.jobs
        .filter((job) => job.isListed !== false)
        .map((job) =>
          buildJob({
            source: "ashby",
            sourceJobId: job.id,
            url: job.jobUrl,
            applyUrl: job.applyUrl ?? `${job.jobUrl}/application`,
            companyName: companyOf(board),
            title: job.title,
            description: job.descriptionPlain ?? "",
            locations: locationsFromText([
              job.location,
              ...(job.secondaryLocations ?? []).map((item) => item.location),
            ]),
            workModeHints: [
              job.workplaceType ?? undefined,
              job.isRemote === true ? "remote" : undefined,
            ],
            employmentLabel: job.employmentType ?? undefined,
            postedAt: toIso(job.publishedAt),
          }),
        ),
    };
  },
});
