import { z } from "zod";
import { escapedHtmlToText } from "../normalize";
import { createAdapter } from "./adapter";
import { buildJob, companyOf, locationsFromText, parseJson, toIso } from "./build";

// Public job board API: https://developers.greenhouse.io/job-board.html
const schema = z.object({
  jobs: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      absolute_url: z.string(),
      company_name: z.string().nullish(),
      location: z.object({ name: z.string().nullish() }).nullish(),
      content: z.string().nullish(),
      first_published: z.string().nullish(),
      updated_at: z.string().nullish(),
    }),
  ),
});

export const greenhouse = createAdapter({
  id: "greenhouse",
  endpoint: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
  parse: (body, board) => {
    const data = parseJson(body, schema);
    if (!data) return undefined;
    return {
      jobs: data.jobs.map((job) =>
        buildJob({
          source: "greenhouse",
          sourceJobId: String(job.id),
          url: job.absolute_url,
          companyName: companyOf(board, job.company_name),
          title: job.title,
          // The API sends HTML that is escaped once more inside the JSON string.
          description: escapedHtmlToText(job.content ?? ""),
          locations: locationsFromText([job.location?.name]),
          postedAt: toIso(job.first_published ?? job.updated_at),
        }),
      ),
    };
  },
});
