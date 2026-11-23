import { load } from "cheerio";
import { htmlToText, normalizeLocation, collapseWhitespace, type JobLocation } from "../normalize";
import { createAdapter, type ParsedPage } from "./adapter";
import { buildJob, companyOf, toIso } from "./build";
import type { BoardRef } from "./types";

// Public XML feed: https://<company>.jobs.personio.de/xml (one document, no pagination).
function parse(body: string, board: BoardRef): ParsedPage | undefined {
  const $ = load(body, { xml: true });
  if ($("workzag-jobs").length === 0) return undefined;

  const jobs = [];
  for (const element of $("position").toArray()) {
    const position = $(element);
    const field = (name: string): string =>
      collapseWhitespace(position.children(name).first().text());
    const id = field("id");
    const title = field("name");
    if (id === "" || title === "") {
      // A posting that cannot be read means the feed changed: fail the scan, never close postings on a partial read.
      return undefined;
    }

    const offices = [
      field("office"),
      ...position
        .find("additionalOffices > office")
        .toArray()
        .map((node) => $(node).text()),
    ];
    const description = position
      .find("jobDescriptions > jobDescription > value")
      .toArray()
      .map((node) => htmlToText($(node).text()))
      .filter((text) => text !== "")
      .join("\n\n");

    jobs.push(
      buildJob({
        source: "personio",
        sourceJobId: id,
        url: `https://${board.slug}.jobs.personio.de/job/${id}`,
        companyName: companyOf(board, field("subcompany")),
        title,
        description,
        locations: offices
          .map((office) => collapseWhitespace(office))
          .filter((office) => office !== "")
          .map((office): JobLocation => normalizeLocation(office)),
        employmentLabel: `${field("employmentType")} ${field("schedule")}`,
        seniorityLabel: field("seniority"),
        postedAt: toIso(field("createdAt")),
      }),
    );
  }
  return { jobs };
}

export const personio = createAdapter({
  id: "personio",
  endpoint: (slug) => `https://${slug}.jobs.personio.de/xml`,
  parse,
});
