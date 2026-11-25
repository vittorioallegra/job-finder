import { z } from "zod";
import { resolvePlace } from "../normalize/geo";
import { findCareersPage } from "./careers-page";
import { normalizeCompanyName } from "./company-name";
import type { SearchOptions } from "./source";
import type { DiscoveryCandidate, DiscoveryCriteria } from "./types";

/**
 * Companies by country from DBpedia, the open knowledge base extracted from Wikipedia: its entries
 * carry the country a company is based in and its website, which no job site gives. DBpedia's
 * robots.txt leaves its SPARQL endpoint open, and a run asks it once per country. The company's
 * own site then shows its careers page (`findCareersPage`). Coverage depends on what Wikipedia
 * knows of the country: the larger employers, in every industry.
 */
const SPARQL = "https://dbpedia.org/sparql";

/** Rows asked per country. */
const ROWS = 3000;

/** Companies whose careers page is looked up in one run. */
export const MAX_REGISTRY_COMPANIES = 40;

/** Sites that list other companies' jobs or are platforms: never a company's own careers page. */
const NOT_COMPANY_SITES =
  /(^|\.)(linkedin|indeed|glassdoor|monster|infojobs|jobrapido|subito|careerjet|simplyhired|ziprecruiter|facebook|instagram|twitter|youtube|wikipedia|google|github|archive)\./i;

const Bindings = z.object({
  results: z.object({
    bindings: z.array(
      z.object({
        name: z.object({ value: z.string() }),
        site: z.object({ value: z.string() }),
      }),
    ),
  }),
});

export interface RegistryEntry {
  name: string;
  website: string;
}

/** DBpedia names a country as its English Wikipedia title: "Italy", "United_States". */
export function dbpediaCountry(countryCode: string): string | undefined {
  const name = new Intl.DisplayNames(["en"], { type: "region" }).of(countryCode);
  return name === undefined || name === countryCode ? undefined : name.replace(/ /g, "_");
}

export function registryQuery(country: string): string {
  return `SELECT DISTINCT ?name ?site WHERE {
  ?c a dbo:Company ; dbo:locationCountry dbr:${country} ; foaf:homepage ?site ; rdfs:label ?name .
  FILTER(lang(?name) = "en")
} LIMIT ${ROWS}`;
}

/** The country codes of the criteria's places that are single countries. */
export function registryCountries(criteria: DiscoveryCriteria): string[] {
  const codes = new Set<string>();
  for (const place of criteria.locations) {
    const resolved = resolvePlace(place);
    if (resolved.kind === "countries" && resolved.codes.length === 1) {
      codes.add(resolved.codes[0] as string);
    }
  }
  return [...codes];
}

function hostOf(site: string): string | undefined {
  try {
    return new URL(site).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** The company sites of one country, one per host, without job-list sites and unnamed entries. */
export async function registryEntries(
  countryCode: string,
  options: SearchOptions,
): Promise<RegistryEntry[] | undefined> {
  const country = dbpediaCountry(countryCode);
  if (country === undefined || !/^[A-Za-z_]+$/.test(country)) return undefined;
  const params = new URLSearchParams({
    query: registryQuery(country),
    format: "application/sparql-results+json",
  });
  const answer = await options.http.get(`${SPARQL}?${params.toString()}`, {
    signal: options.signal,
  });
  if (!answer.ok) return undefined;
  let parsed: z.output<typeof Bindings>;
  try {
    parsed = Bindings.parse(JSON.parse(answer.body));
  } catch {
    return undefined;
  }
  const seen = new Set<string>();
  const entries: RegistryEntry[] = [];
  for (const row of parsed.results.bindings) {
    // "Jil Sander (company)" and "(brand)" are disambiguations of a title, not part of the name.
    const name = row.name.value
      .replace(/\s*\((company|brand|business|corporation)\)\s*$/i, "")
      .trim();
    if (name === "") continue;
    const host = hostOf(row.site.value);
    if (host === undefined || NOT_COMPANY_SITES.test(`${host}.`) || seen.has(host)) continue;
    seen.add(host);
    entries.push({ name, website: row.site.value });
  }
  return entries;
}

/** Careers pages looked up in this session, by host: a site is read once. */
const looked = new Map<string, DiscoveryCandidate | null>();

/**
 * Companies of the criteria's countries, as careers pages or boards to scan: DBpedia names them,
 * each site is read for its careers page. Sites already followed (`criteria.known`) and sites read
 * earlier in the session are skipped. `answered` counts the countries DBpedia answered for.
 */
export async function discoverFromRegistry(
  criteria: DiscoveryCriteria,
  options: SearchOptions,
): Promise<{ candidates: DiscoveryCandidate[]; answered: number }> {
  const known = new Set((criteria.known ?? []).map((host) => host.replace(/^www\./, "")));
  const candidates: DiscoveryCandidate[] = [];
  const names = new Set<string>();
  let answered = 0;

  for (const country of registryCountries(criteria)) {
    if (options.signal?.aborted) break;
    const entries = await registryEntries(country, options);
    if (entries === undefined) continue;
    answered += 1;
    const todo = entries
      .filter((entry) => {
        const host = hostOf(entry.website) ?? "";
        return !known.has(host) && !looked.has(host);
      })
      .slice(0, MAX_REGISTRY_COMPANIES);
    // The sites are different hosts, so a few are read at once; each host still gets one request a second.
    for (let start = 0; start < todo.length; start += 5) {
      const batch = todo.slice(start, start + 5);
      const found = await Promise.all(
        batch.map((entry) =>
          findCareersPage(entry.name, entry.website, options).catch(() => undefined),
        ),
      );
      batch.forEach((entry, index) => {
        looked.set(hostOf(entry.website) ?? "", found[index] ?? null);
        const candidate = found[index];
        const key = normalizeCompanyName(entry.name);
        if (candidate && !names.has(key)) {
          names.add(key);
          candidates.push(candidate);
        }
      });
    }
  }
  return { candidates, answered };
}
