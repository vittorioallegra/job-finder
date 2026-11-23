import { load } from "cheerio";
import { htmlToText, locationFromParts, type JobLocation } from "../normalize";
import { createAdapter, type ParsedPage } from "./adapter";
import { buildJob, companyOf, toIso } from "./build";
import type { BoardRef } from "./types";

// Public job feed of a career site: https://<company>.teamtailor.com/jobs.rss
function parse(body: string, board: BoardRef): ParsedPage | undefined {
  const $ = load(body, { xml: true });
  if ($("rss").length === 0) return undefined;

  const jobs = [];
  for (const element of $("item").toArray()) {
    const item = $(element);
    const field = (name: string): string => item.children(name).first().text().trim();
    const link = field("link");
    const guid = field("guid") || link;
    if (guid === "" || link === "") continue;

    const remoteStatus = field("remoteStatus").toLowerCase();
    const locations = item
      .find("tt\\:location")
      .toArray()
      .map((node) => {
        const place = $(node);
        return locationFromParts({
          city: place.children("tt\\:city").first().text(),
          country: place.children("tt\\:country").first().text(),
          raw: place.children("tt\\:name").first().text(),
        });
      })
      .filter((location): location is JobLocation => location !== undefined);

    jobs.push(
      buildJob({
        source: "teamtailor",
        sourceJobId: guid,
        url: link,
        companyName: companyOf(board),
        title: field("title"),
        description: htmlToText(field("description")),
        locations,
        workModeHints: [
          remoteStatus === "hybrid" ? "hybrid" : undefined,
          remoteStatus === "remote" || remoteStatus === "fully" ? "remote" : undefined,
        ],
        postedAt: toIso(field("pubDate")),
      }),
    );
  }
  return { jobs };
}

export const teamtailor = createAdapter({
  id: "teamtailor",
  endpoint: (slug) => `https://${slug}.teamtailor.com/jobs.rss`,
  parse,
});
