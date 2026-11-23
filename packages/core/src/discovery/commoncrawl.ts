import { z } from "zod";
import { ATS_SEARCH_SITES } from "./query";
import type { BoardSource, SearchResult, SearchOptions } from "./source";

/**
 * The Common Crawl collection the index is read from. Collections are published every month or so;
 * the id is checked against https://index.commoncrawl.org/collinfo.json when it is changed.
 */
export const COMMON_CRAWL_INDEX = "CC-MAIN-2026-43-index";
const CDX_ENDPOINT = `https://index.commoncrawl.org/${COMMON_CRAWL_INDEX}`;

/**
 * Captures returned per ATS domain. The index is sorted by URL, so one domain's sample is partial:
 * this source seeds the company list, it does not list every board.
 */
export const COMMON_CRAWL_LIMIT = 500;

const CaptureLine = z.object({ url: z.string() });

/** Every ATS domain the search also uses, each read with its subdomains. */
const ATS_DOMAINS: readonly string[] = [...new Set(Object.values(ATS_SEARCH_SITES).flat())];

/** The CDX query for one domain: captures with status 200, URLs only, as newline-delimited JSON. */
export function cdxUrl(domain: string): string {
  const params = new URLSearchParams({
    url: domain,
    matchType: "domain",
    output: "json",
    fl: "url",
    filter: "status:200",
    limit: String(COMMON_CRAWL_LIMIT),
  });
  return `${CDX_ENDPOINT}?${params.toString()}`;
}

/** The URLs of newline-delimited CDX output. Lines that are not a capture are skipped. */
export function parseCdxLines(body: string): string[] {
  const urls: string[] = [];
  for (const line of body.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = CaptureLine.safeParse(JSON.parse(line));
      if (parsed.success) urls.push(parsed.data.url);
    } catch {
      // A malformed line is skipped; the rest of the sample is still used.
    }
  }
  return urls;
}

/**
 * Common Crawl's URL index for the ATS domains, read through the shared HTTP client (so robots.txt,
 * the per-host queue and the 10-minute response cache apply). Keyless and independent of the search
 * keywords: the index has no posting text. A domain with no captures answers 404, which is an empty
 * result. The run fails only when every domain fails.
 */
export const commonCrawlSource: BoardSource = {
  id: "common-crawl",
  async urls({ http, signal }: SearchOptions): Promise<SearchResult> {
    const urls: string[] = [];
    let succeeded = 0;
    let failure: SearchResult | undefined;
    for (const domain of ATS_DOMAINS) {
      if (signal?.aborted) break;
      const result = await http.get(cdxUrl(domain), { signal });
      if (result.ok) {
        succeeded += 1;
        urls.push(...parseCdxLines(result.body));
      } else if (result.code === "http-status" && result.status === 404) {
        succeeded += 1;
      } else {
        failure = { ok: false, code: result.code };
      }
    }
    if (succeeded > 0) return { ok: true, urls };
    return failure ?? { ok: false, code: "aborted" };
  },
};
