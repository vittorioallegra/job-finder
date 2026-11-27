import { detectAtsFromUrl } from "../ats/detect";
import { countryOfCity, mainCity } from "../normalize/cities";
import { resolvePlace } from "../normalize/geo";
import { findCareersPage } from "./careers-page";
import type { SearchOptions, SearchSource } from "./source";
import type { DiscoveryCandidate, DiscoveryCriteria } from "./types";

/**
 * Companies with their own site, found through web search. The ATS searches only see boards, so a
 * company that hires from its own careers page (most consulting, IT services and staffing firms:
 * Accenture, Engineering, Hays...) never shows up there. These queries ask for the careers pages
 * themselves, written the way the places' countries write them, and for the companies of a sector;
 * each result site is then read for its careers page (`findCareersPage`).
 */

/** How "careers" is written where the posting is, by country. English is always asked too. */
const LOCAL_CAREERS: Record<string, readonly string[]> = {
  IT: ["lavora con noi", "posizioni aperte"],
  DE: ["Karriere", "Stellenangebote"],
  AT: ["Karriere", "Stellenangebote"],
  CH: ["Karriere", "Stellenangebote"],
  FR: ["recrutement", "carrières"],
  ES: ["trabaja con nosotros", "empleo"],
  PT: ["trabalhe connosco", "carreiras"],
  NL: ["werken bij", "vacatures"],
  BE: ["werken bij", "vacatures"],
  PL: ["kariera", "oferty pracy"],
};

/** Sector phrases, asked with each place: companies, not postings. Local wording first. */
const LOCAL_SECTOR: Record<string, readonly string[]> = {
  IT: [
    "multinazionale consulenza tecnologica",
    "agenzia per il lavoro IT",
    "system integrator",
    "società di consulenza informatica",
  ],
  DE: ["IT-Beratung", "Softwarehaus"],
  FR: ["société de conseil informatique", "ESN"],
  ES: ["consultora tecnológica", "empresa de software"],
};
const SECTOR_PHRASES = ["IT consulting software company", "software house"];

/** Sites that list other companies' jobs, review them or are platforms: never a company's own site. */
const AGGREGATORS = [
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "monster.com",
  "infojobs.it",
  "jobrapido.com",
  "subito.it",
  "careerjet.it",
  "ziprecruiter.com",
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "wikipedia.org",
  "reddit.com",
  "twitter.com",
  "x.com",
  "medium.com",
  "pinterest.com",
  "trovit.it",
  "jooble.org",
  "talent.com",
  "adzuna.it",
  "adzuna.com",
  "kelly.it",
  "clutch.co",
  "goodfirms.co",
  "trustpilot.com",
  "builtin.com",
  "devjobsscanner.com",
  "sortlist.com",
  "wellfound.com",
  "angel.co",
  "crunchbase.com",
  "ambitionbox.com",
  "levels.fyi",
  "welcometothejungle.com",
  "jobmetasearch.ai",
  "theirstack.com",
  "englishjobs.it",
  "euroengineerjobs.com",
];

/** Companies whose careers page is looked up in one run. */
export const MAX_SITE_COMPANIES = 40;

/** Queries per run: a keyless search source refuses a burst, so few and spread over the places. */
export const MAX_SITE_QUERIES = 16;

function exclusions(): string {
  return AGGREGATORS.slice(0, 6)
    .map((site) => `-site:${site}`)
    .join(" ");
}

/** The country codes of the places that are single countries. */
function countryCodes(places: readonly string[]): string[] {
  const codes: string[] = [];
  for (const place of places) {
    const resolved = resolvePlace(place);
    if (resolved.kind === "countries" && resolved.codes.length === 1) {
      codes.push(resolved.codes[0] as string);
    } else {
      const code = countryOfCity(place);
      if (code !== undefined) codes.push(code);
    }
  }
  return codes;
}

/**
 * Queries for company sites: for each place a careers query per role in the local and in English
 * wording, and a sector query. Roles and places come first in turn, so the cap keeps a mix.
 */
export function companyQueries(
  criteria: DiscoveryCriteria,
  maxQueries = MAX_SITE_QUERIES,
): string[] {
  const places = criteria.locations.map((place) => place.trim()).filter((place) => place !== "");
  const roles = criteria.keywords.map((term) => term.trim()).filter((term) => term !== "");
  const codes = countryCodes(places);
  const local = [...new Set(codes.flatMap((code) => LOCAL_CAREERS[code] ?? []))];
  const wording = [...local.slice(0, 1), "careers", ...local.slice(1, 2)];
  const queries: string[] = [];
  const clean = (text: string): string => text.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
  for (const place of places.length > 0 ? places : [""]) {
    for (const role of roles.length > 0 ? roles : [""]) {
      for (const word of wording) {
        const parts = [
          `"${clean(word)}"`,
          role && `"${clean(role)}"`,
          place && `"${clean(place)}"`,
        ];
        queries.push(`${parts.filter(Boolean).join(" ")} ${exclusions()}`);
      }
    }
    const sector = [...codes.flatMap((code) => LOCAL_SECTOR[code] ?? []), ...SECTOR_PHRASES];
    // A country alone returns national lists; its main city returns the firms that work there.
    const sectorPlaces = [place, ...(codes.length > 0 ? [mainCity(codes[0] as string) ?? ""] : [])];
    for (const phrase of sector.slice(0, 5)) {
      for (const where of sectorPlaces) {
        queries.push(
          `${phrase} ${where && `"${clean(where)}"`} ${exclusions()}`.replace(/\s+/g, " "),
        );
      }
    }
  }
  // Spread the cap over the kinds: take queries from the start, the middle and the end alternately.
  const picked: string[] = [];
  for (let low = 0, high = queries.length - 1; picked.length < maxQueries && low <= high;) {
    picked.push(queries[low++] as string);
    if (picked.length < maxQueries && low <= high) picked.push(queries[high--] as string);
  }
  return picked;
}

function siteOf(url: string): URL | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a result belongs to the places' countries: the country's own domain, its language in the
 * address (/it-it/, /it/) or its name. A search for "careers" alone also returns the world's big
 * employers, and each site kept costs a scan. With no country in the places nothing is dropped.
 */
export function isInCountries(url: URL, codes: readonly string[]): boolean {
  if (codes.length === 0) return true;
  const where = `${url.hostname}${url.pathname}`.toLowerCase();
  return codes.some((code) => {
    const lower = code.toLowerCase();
    const names = [
      new Intl.DisplayNames(["en"], { type: "region" }).of(code),
      new Intl.DisplayNames([lower], { type: "region" }).of(code),
    ]
      .filter((name): name is string => name !== undefined && name !== code)
      .map((name) => name.toLowerCase().replace(/\s+/g, "-"));
    return (
      url.hostname.toLowerCase().endsWith(`.${lower}`) ||
      new RegExp(`/${lower}([-_/]|$)`).test(url.pathname.toLowerCase()) ||
      names.some((name) => where.includes(name))
    );
  });
}

function isAggregator(host: string): boolean {
  return AGGREGATORS.some((site) => host === site || host.endsWith(`.${site}`));
}

/** "www.orbyta.it" → "Orbyta": a readable name until the careers page gives a better one. */
export function nameFromHost(host: string): string {
  const parts = host.replace(/^www\./, "").split(".");
  // A company's board on a shared platform ("leonardocompany.wd3.myworkdayjobs.com") is named by its tenant.
  if (/(myworkdayjobs|successfactors|taleo|icims|ultipro)\./.test(host)) {
    return titleCase(parts[0] ?? host);
  }
  const label =
    parts.length > 2 && ["co", "com", "org", "net"].includes(parts[parts.length - 2] as string)
      ? parts[parts.length - 3]
      : parts[Math.max(0, parts.length - 2)];
  return titleCase(label ?? host);
}

function titleCase(label: string): string {
  const text = label.replace(/[-_]+/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Sites looked up in this session, by host: a site is read once. */
const looked = new Map<string, DiscoveryCandidate | null>();

/**
 * Companies named by the result URLs of the company queries: ATS boards are left to the board
 * search; every other site that is not a job-list site is read for its careers page. Sites already
 * followed (`criteria.known`) and sites read earlier in the session are skipped.
 */
export async function discoverCompanySites(
  criteria: DiscoveryCriteria,
  sources: readonly SearchSource[],
  options: SearchOptions,
  blocked: Set<SearchSource>,
): Promise<{ candidates: DiscoveryCandidate[]; answered: number; blocked: boolean }> {
  const known = new Set((criteria.known ?? []).map((host) => host.replace(/^www\./, "")));
  const hosts = new Map<string, URL>();
  const codes = countryCodes(criteria.locations);
  let answered = 0;
  let sawBlock = false;

  queryLoop: for (const query of companyQueries(criteria)) {
    for (const source of sources) {
      if (options.signal?.aborted) break queryLoop;
      if (blocked.has(source)) continue;
      const result = await source.search(query, options);
      if (!result.ok) {
        if (result.code === "blocked" || result.code === "blocked-by-robots") {
          sawBlock = true;
          blocked.add(source);
        }
        continue;
      }
      answered += 1;
      for (const url of result.urls) {
        const parsed = siteOf(url);
        if (!parsed || detectAtsFromUrl(url)) continue;
        const host = parsed.hostname.replace(/^www\./, "");
        if (isAggregator(host) || known.has(host) || looked.has(host) || hosts.has(host)) continue;
        if (!isInCountries(parsed, codes)) continue;
        hosts.set(host, parsed);
      }
    }
    if (sources.length > 0 && blocked.size === sources.length) break;
  }

  const todo = [...hosts.entries()].slice(0, MAX_SITE_COMPANIES);
  const candidates: DiscoveryCandidate[] = [];
  for (let start = 0; start < todo.length; start += 5) {
    if (options.signal?.aborted) break;
    const batch = todo.slice(start, start + 5);
    const found = await Promise.all(
      batch.map(([host, url]) =>
        findCareersPage(nameFromHost(host), url.origin, options).catch(() => undefined),
      ),
    );
    batch.forEach(([host], index) => {
      looked.set(host, found[index] ?? null);
      const candidate = found[index];
      if (candidate) candidates.push(candidate);
    });
  }
  return { candidates, answered, blocked: sawBlock };
}
