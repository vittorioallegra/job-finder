import { load } from "cheerio";
import { buildJob, locationsFromText } from "../ats/build";
import type { HttpClient } from "../net";
import { htmlToText, type NormalizedJob } from "../normalize";

/** Source id of postings read from a company's own pages. */
export const STRUCTURED_SOURCE = "careers-page";

/** Posting pages read per company in one scan. */
export const MAX_SITEMAP_POSTINGS = 60;
const MAX_SITEMAP_FILES = 6;
const MAX_DESCRIPTION_CHARS = 4_000;
const SITEMAP_MAX_BYTES = 5 * 1024 * 1024;

/** Paths that name a single posting rather than a listing. */
const POSTING_PATH =
  /(job|jobs|position|positions|posizion|posizione|career|careers|karriere|stelle|stellen|vacanc|vacature|offerta|offerte|lavoro|opening|openings|emploi|empleo)[-_/]/i;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

function typeIncludes(node: Json, type: string): boolean {
  const value = node["@type"];
  return Array.isArray(value) ? value.includes(type) : value === type;
}

/** Every JobPosting node in the page's JSON-LD blocks, through @graph, arrays and item lists. */
function jobPostingNodes(html: string): Json[] {
  const $ = load(html);
  const found: Json[] = [];
  const visit = (node: unknown, depth: number): void => {
    if (depth > 6) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (!isObject(node)) return;
    if (typeIncludes(node, "JobPosting")) {
      found.push(node);
      return;
    }
    visit(node["@graph"], depth + 1);
    visit(node["itemListElement"], depth + 1);
    visit(node["item"], depth + 1);
    visit(node["mainEntity"], depth + 1);
  };
  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).contents().text();
    try {
      visit(JSON.parse(raw), 0);
    } catch {
      // A broken block is ignored; the page may still carry other postings.
    }
  });
  return found;
}

/** Place names of a posting: the address of each location, as one text each. */
function placesOf(node: Json): string[] {
  const places: string[] = [];
  const locations = node["jobLocation"];
  for (const location of Array.isArray(locations) ? locations : [locations]) {
    if (!isObject(location)) continue;
    const address = isObject(location["address"]) ? location["address"] : undefined;
    if (!address) {
      const name = text(location["name"]);
      if (name) places.push(name);
      continue;
    }
    const country = isObject(address["addressCountry"])
      ? text(address["addressCountry"]["name"])
      : text(address["addressCountry"]);
    const parts = [text(address["addressLocality"]), text(address["addressRegion"]), country];
    const joined = parts.filter((part): part is string => part !== undefined).join(", ");
    if (joined) places.push(joined);
  }
  const applicant = node["applicantLocationRequirements"];
  for (const requirement of Array.isArray(applicant) ? applicant : [applicant]) {
    if (isObject(requirement) && node["jobLocationType"] === "TELECOMMUTE") {
      const name = text(requirement["name"]);
      if (name) places.push(`Remote - ${name}`);
    }
  }
  return places;
}

/** One normalized job from a JobPosting node, or undefined when it has no title. */
function jobFromNode(node: Json, pageUrl: string, companyName: string): NormalizedJob | undefined {
  const title = text(node["title"]) ?? text(node["name"]);
  if (title === undefined) return undefined;
  const link = text(node["url"]);
  let url = pageUrl;
  if (link) {
    try {
      url = new URL(link, pageUrl).toString();
    } catch {
      url = pageUrl;
    }
  }
  const identifier = isObject(node["identifier"])
    ? (text(node["identifier"]["value"]) ?? text(node["identifier"]["name"]))
    : text(node["identifier"]);
  const places = placesOf(node);
  const remote = node["jobLocationType"] === "TELECOMMUTE";
  const employment = Array.isArray(node["employmentType"])
    ? text(node["employmentType"][0])
    : text(node["employmentType"]);
  return buildJob({
    source: STRUCTURED_SOURCE,
    sourceJobId: identifier ? `${url}#${identifier}` : url,
    url,
    companyName,
    title,
    description: htmlToText(text(node["description"]) ?? "").slice(0, MAX_DESCRIPTION_CHARS),
    locations: locationsFromText(remote && places.length === 0 ? ["Remote"] : places),
    workModeHints: remote ? ["remote"] : undefined,
    employmentLabel: employment?.replace(/_/g, " ").toLowerCase(),
    postedAt: text(node["datePosted"]),
  });
}

/**
 * The postings a page declares as schema.org JobPosting data, the markup job sites read to list
 * a role. No model is involved: the company states each posting itself.
 */
export function postingsFromPage(
  html: string,
  pageUrl: string,
  companyName: string,
): NormalizedJob[] {
  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();
  for (const node of jobPostingNodes(html)) {
    const job = jobFromNode(node, pageUrl, companyName);
    if (job === undefined || seen.has(job.sourceJobId)) continue;
    seen.add(job.sourceJobId);
    jobs.push(job);
  }
  return jobs;
}

function locs(xml: string): string[] {
  return [
    ...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s][^<\]]*?)\s*(?:\]\]>)?\s*<\/loc>/gi),
  ].map((match) => match[1] as string);
}

/**
 * The posting pages a company's sitemap lists on its careers host: robots.txt names the sitemaps,
 * a sitemap index is followed a few files deep, and only addresses that read as one posting count.
 */
export async function sitemapPostingUrls(
  careersUrl: string,
  http: HttpClient,
  signal?: AbortSignal,
): Promise<string[]> {
  const origin = new URL(careersUrl).origin;
  const host = new URL(careersUrl).hostname.replace(/^www\./, "");
  const queue: string[] = [];
  const robots = await http.get(`${origin}/robots.txt`, { signal });
  if (robots.ok) {
    for (const match of robots.body.matchAll(/^\s*sitemap:\s*(\S+)/gim))
      queue.push(match[1] as string);
  }
  if (queue.length === 0) queue.push(`${origin}/sitemap.xml`);

  const urls: string[] = [];
  const seen = new Set<string>();
  let files = 0;
  while (queue.length > 0 && files < MAX_SITEMAP_FILES) {
    if (signal?.aborted) break;
    const next = queue.shift() as string;
    if (seen.has(next)) continue;
    seen.add(next);
    files += 1;
    const answer = await http.get(next, { signal, maxBodyBytes: SITEMAP_MAX_BYTES });
    if (!answer.ok) continue;
    const entries = locs(answer.body);
    if (/<sitemapindex/i.test(answer.body)) {
      // Job sitemaps first: a company with many sitemaps keeps its postings in one named for them.
      const sorted = entries.sort(
        (a, b) => Number(POSTING_PATH.test(`${b}-`)) - Number(POSTING_PATH.test(`${a}-`)),
      );
      queue.push(...sorted);
      continue;
    }
    for (const entry of entries) {
      let url: URL;
      try {
        url = new URL(entry);
      } catch {
        continue;
      }
      if (url.hostname.replace(/^www\./, "") !== host) continue;
      if (!POSTING_PATH.test(`${url.pathname}/`)) continue;
      if (url.pathname.split("/").filter(Boolean).length < 2) continue;
      url.hash = "";
      urls.push(url.toString());
    }
  }
  return [...new Set(urls)];
}
