import { load } from "cheerio";
import { detectAtsFromPage, detectAtsFromUrl } from "../ats/detect";
import type { AtsId } from "../ats/types";
import { canonicalBoardUrl } from "./boards";
import type { SearchOptions } from "./source";
import type { DiscoveryCandidate } from "./types";

/**
 * Words that name a careers page in the languages companies write in: careers, jobs, "lavora con
 * noi", Karriere, Stellenangebote, carrières, empleo, vacatures, kariera, carreira, jobb.
 */
export const CAREERS_WORDS =
  /career|carri[eè]re|carriere|\bjobs?\b|lavora[- ]?con[- ]?noi|lavora[- ]con|lavora[- ]in\b|posizioni[- ]aperte|ricerca[- ]offerte|offerte[- ]di[- ]lavoro|join[- ]?us|work[- ]with[- ]us|open[- ]positions|karriere|stellen|emploi|recrut|empleo|trabaja|vacature|werken[- ]bij|kariera|oferty[- ]pracy|carreira|trabalhe|ledige|rekry|ty[oö]paikat/i;

/**
 * Links that match a careers word without being the careers page: a candidate's account, its job
 * alerts, career advice articles, news.
 */
const NOT_CAREERS_PAGE =
  /my-account|account|alert|insight|consigli|advice|blog|news|press|risorse|resources|login|signin|newsletter|saved|mypage|my-page|profile|register|cookie|privacy|publish|post-a-job|post-job|use-cases|tailor|expiring|resume/i;

/** Paths tried when a site's pages link no careers page. */
const FALLBACK_PATHS = ["/careers", "/jobs", "/lavora-con-noi"];

/** Largest page read: a careers or home page is small; a huge answer is not one. */
const PAGE_MAX_BYTES = 2 * 1024 * 1024;

/** The board an ATS URL or an embedded ATS link names, as a candidate, or undefined. */
function boardCandidate(
  name: string,
  detection: { ats: AtsId; slug?: string } | undefined,
): DiscoveryCandidate | undefined {
  if (!detection || detection.slug === undefined) return undefined;
  const careersUrl = canonicalBoardUrl(detection.ats, detection.slug);
  return careersUrl === undefined
    ? undefined
    : { ats: detection.ats, slug: detection.slug, careersUrl, name };
}

/** Links of a page that look like a careers page, best first. */
export function careersLinks(html: string, base: string): string[] {
  const $ = load(html);
  const scored: { url: string; score: number }[] = [];
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) return;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    const text = $(element).text().trim();
    const inPath = CAREERS_WORDS.test(url.pathname);
    const inText = text.length > 0 && text.length < 60 && CAREERS_WORDS.test(text);
    if (!inPath && !inText) return;
    // A link to an ATS board, or to the company's own site, beats a link to somewhere else.
    const own = url.hostname.replace(/^www\./, "") === new URL(base).hostname.replace(/^www\./, "");
    const score =
      (NOT_CAREERS_PAGE.test(`${url.pathname} ${text}`) ? -6 : 0) +
      (detectAtsFromUrl(url.toString()) ? 5 : 0) +
      (own ? 2 : 0) +
      (inText ? 1 : 0) +
      (inPath ? 1 : 0);
    scored.push({ url: url.toString(), score });
  });
  const seen = new Set<string>();
  return scored
    .sort((a, b) => b.score - a.score)
    .map((item) => item.url)
    .filter((url) => (seen.has(url) ? false : (seen.add(url), true)));
}

async function page(url: string, options: SearchOptions): Promise<string | undefined> {
  const answer = await options.http.get(url, {
    signal: options.signal,
    maxBodyBytes: PAGE_MAX_BYTES,
  });
  return answer.ok ? answer.body : undefined;
}

/** "www.soprasteria.it" and "careers.soprasteria.it" share "soprasteria.it": the last two labels. */
function baseDomain(host: string): string {
  return host.split(".").slice(-2).join(".");
}

/**
 * A careers page often only introduces the jobs and links the real board on a careers subdomain of
 * the same company ("careers.soprasteria.it"): that link is the page to read.
 */
function careersSubdomain(html: string, page: string): string | undefined {
  const home = new URL(page);
  const $ = load(html);
  let found: string | undefined;
  $("a[href]").each((_, element) => {
    if (found !== undefined) return;
    let url: URL;
    try {
      url = new URL($(element).attr("href") ?? "", page);
    } catch {
      return;
    }
    if (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.hostname !== home.hostname &&
      baseDomain(url.hostname) === baseDomain(home.hostname) &&
      /^(careers?|jobs?|carriere|lavora|lavoraconnoi|recruiting|recruitment)\./i.test(url.hostname)
    ) {
      found = url.origin + url.pathname;
    }
  });
  return found;
}

/**
 * From a company's website to what a scan can read: the home page is read for an ATS it embeds or
 * a careers link; the careers page for an ATS board it links. Finds a board when there is one, and
 * otherwise the careers page itself (read later by the generic careers reader). Returns undefined
 * when the site shows no careers page. At most three pages are read.
 */
export async function findCareersPage(
  name: string,
  website: string,
  options: SearchOptions,
): Promise<DiscoveryCandidate | undefined> {
  let origin: URL;
  try {
    origin = new URL(website.includes("://") ? website : `https://${website}`);
  } catch {
    return undefined;
  }
  const home = await page(origin.origin, options);
  if (home !== undefined) {
    const embedded = boardCandidate(name, detectAtsFromPage(home));
    if (embedded) return embedded;
  }

  const links = home !== undefined ? careersLinks(home, origin.origin) : [];
  const urls =
    links.length > 0
      ? links.slice(0, 2)
      : FALLBACK_PATHS.slice(0, 2).map((path) => new URL(path, origin.origin).toString());

  for (const url of urls) {
    if (options.signal?.aborted) return undefined;
    const direct = boardCandidate(name, detectAtsFromUrl(url));
    if (direct) return direct;
    const html = await page(url, options);
    if (html === undefined) continue;
    const embedded = boardCandidate(name, detectAtsFromPage(html));
    if (embedded) return embedded;
    // A page that answers and reads like a careers page is the company's careers page. A fallback
    // path must also say so in its text, or any site's "/jobs" would count.
    const text = load(html)("body").text().slice(0, 4000);
    if (links.length > 0 || CAREERS_WORDS.test(text)) {
      return { ats: null, slug: null, careersUrl: careersSubdomain(html, url) ?? url, name };
    }
  }
  return undefined;
}
