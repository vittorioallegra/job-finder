import { load } from "cheerio";
import type { SearchSource } from "./source";

export const DUCKDUCKGO_SOURCE_ID = "duckduckgo-html";
const ENDPOINT = "https://html.duckduckgo.com/html/";

/** Markers of DuckDuckGo's bot challenge page, which replaces the results for scripted clients. */
const CHALLENGE_MARKERS = ["anomaly-modal", "anomaly.js"];

/** Result links point through DuckDuckGo's redirect (`/l/?uddg=<target>`) or straight at the target. */
export function resultTarget(href: string): string | undefined {
  const absolute = href.startsWith("//") ? `https:${href}` : href;
  let parsed: URL;
  try {
    parsed = new URL(absolute);
  } catch {
    return undefined;
  }
  if (parsed.hostname.endsWith("duckduckgo.com") && parsed.pathname === "/l/") {
    const target = parsed.searchParams.get("uddg");
    return target ? resultTarget(target) : undefined;
  }
  return parsed.protocol === "https:" || parsed.protocol === "http:"
    ? parsed.toString()
    : undefined;
}

/** The result target URLs of one results page, in page order. Empty when the page has no results. */
export function parseResults(html: string): string[] {
  const $ = load(html);
  const urls: string[] = [];
  $("a.result__a").each((_, element) => {
    const href = $(element).attr("href");
    const target = href ? resultTarget(href) : undefined;
    if (target !== undefined) urls.push(target);
  });
  return urls;
}

export function isChallengePage(html: string): boolean {
  return CHALLENGE_MARKERS.some((marker) => html.includes(marker));
}

/**
 * DuckDuckGo's HTML endpoint, read through the shared HTTP client, so robots.txt and the per-host
 * queue apply. Keyless. A bot challenge is reported as `blocked`; the client does not try to get
 * past it.
 */
export const duckDuckGoSource: SearchSource = {
  id: DUCKDUCKGO_SOURCE_ID,
  async search(query, { http, signal }) {
    const result = await http.get(`${ENDPOINT}?q=${encodeURIComponent(query)}`, { signal });
    if (!result.ok) {
      return { ok: false, code: result.code };
    }
    if (isChallengePage(result.body)) {
      return { ok: false, code: "blocked" };
    }
    return { ok: true, urls: parseResults(result.body) };
  },
};
