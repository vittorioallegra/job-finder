import { z } from "zod";
import { resolvePlace } from "../normalize/geo";
import { canonicalBoardUrl } from "./boards";
import type { SearchOptions } from "./source";
import type { DiscoveryCandidate, DiscoveryCriteria } from "./types";

/**
 * Workable's public job directory (jobs.workable.com) lists the openings of every company that
 * uses Workable, searchable by place and keyword. It answers a JSON API that its robots.txt leaves
 * open, so this source asks it, per country and role, which companies hire there, and then finds
 * each company's own board for the regular scan. That is how companies of one country are found:
 * a web search for "Italia" cannot do it.
 */
const DIRECTORY = "https://jobs.workable.com/api/v1/jobs";
const ACCOUNT = "https://apply.workable.com/api/v1/widget/accounts";

/** Pages read per place and keyword (20 postings each): the directory is searched, not copied. */
const PAGES = 2;
/** Companies whose board is looked up in one run, the ones with the most openings first. */
export const MAX_DIRECTORY_COMPANIES = 40;

const Directory = z.object({
  jobs: z.array(
    z.object({
      company: z.object({
        id: z.string(),
        title: z.string(),
        website: z.string().nullish(),
      }),
    }),
  ),
  nextPageToken: z.string().nullish(),
});

const Account = z.object({ name: z.string().nullish() });

interface DirectoryCompany {
  id: string;
  title: string;
  website: string | null;
  openings: number;
}

/**
 * Where to search: each country once, by its English name (the directory's own spelling), or the
 * places as typed when none is a single country.
 */
export function directoryPlaces(locations: readonly string[]): string[] {
  const countries = new Set<string>();
  const texts: string[] = [];
  for (const place of locations) {
    const resolved = resolvePlace(place);
    if (resolved.kind === "countries" && resolved.codes.length === 1) {
      const name = new Intl.DisplayNames(["en"], { type: "region" }).of(
        resolved.codes[0] as string,
      );
      if (name !== undefined) countries.add(name);
    } else if (resolved.kind === "text" && resolved.text !== "") {
      texts.push(resolved.text);
    }
  }
  return countries.size > 0 ? [...countries] : texts;
}

/**
 * The names a company's Workable address may have: its name as written, without the legal form,
 * with no separators, and the first label of its website.
 */
export function slugVariants(title: string, website: string | null): string[] {
  const lower = title
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
  const withoutForm = lower.replace(
    /\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|gmbh|inc\.?|ltd\.?|llc|ag|b\.?v\.?|group|gruppo|italia|italy)\b/g,
    " ",
  );
  const dashed = (text: string) => text.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  let host = "";
  if (website) {
    try {
      host = new URL(website.includes("://") ? website : `https://${website}`).hostname
        .replace(/^www\./, "")
        .split(".")[0] as string;
    } catch {
      host = "";
    }
  }
  const variants = [
    dashed(lower),
    dashed(withoutForm),
    host,
    withoutForm.replace(/[^a-z0-9]+/g, ""),
  ];
  return [...new Set(variants.filter((variant) => variant !== ""))].slice(0, 3);
}

/** Slugs already resolved in this session, so a second run does not ask again. */
const resolved = new Map<string, string | null>();

/** True when the board's account name is the company's: "webranking" for "Webranking". */
function sameCompany(accountName: string, title: string): boolean {
  const fold = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const a = fold(accountName);
  const t = fold(title);
  return a !== "" && t !== "" && (a.startsWith(t) || t.startsWith(a));
}

async function boardOf(company: DirectoryCompany, options: SearchOptions): Promise<string | null> {
  const cached = resolved.get(company.id);
  if (cached !== undefined) return cached;
  for (const variant of slugVariants(company.title, company.website)) {
    if (options.signal?.aborted) return null;
    const answer = await options.http.get(`${ACCOUNT}/${variant}`, { signal: options.signal });
    if (!answer.ok) continue;
    try {
      const account = Account.parse(JSON.parse(answer.body));
      if (account.name && sameCompany(account.name, company.title)) {
        resolved.set(company.id, variant);
        return variant;
      }
    } catch {
      // Not the account's JSON: try the next name.
    }
  }
  resolved.set(company.id, null);
  return null;
}

/**
 * Companies hiring in the criteria's places for its keywords, as Workable boards to scan. Fails
 * only when the directory cannot be read at all; a company whose board is not found is left out.
 */
export async function discoverWorkableDirectory(
  criteria: DiscoveryCriteria,
  options: SearchOptions,
): Promise<
  | { ok: true; candidates: DiscoveryCandidate[]; answered: number }
  | { ok: false; code: "invalid-response" | "failed" }
> {
  const places = directoryPlaces(criteria.locations);
  if (places.length === 0) return { ok: true, candidates: [], answered: 0 };
  const keywords = criteria.keywords.length > 0 ? criteria.keywords : [""];

  const companies = new Map<string, DirectoryCompany>();
  let answered = 0;
  for (const place of places) {
    for (const keyword of keywords) {
      let token: string | null | undefined;
      for (let page = 0; page < PAGES; page += 1) {
        if (options.signal?.aborted) break;
        const params = new URLSearchParams({ location: place });
        if (keyword.trim() !== "") params.set("query", keyword.trim());
        if (token) params.set("pageToken", token);
        const answer = await options.http.get(`${DIRECTORY}?${params.toString()}`, {
          signal: options.signal,
        });
        if (!answer.ok) break;
        let data: z.output<typeof Directory>;
        try {
          data = Directory.parse(JSON.parse(answer.body));
        } catch {
          return { ok: false, code: "invalid-response" };
        }
        answered += 1;
        for (const job of data.jobs) {
          const found = companies.get(job.company.id);
          if (found) found.openings += 1;
          else
            companies.set(job.company.id, {
              id: job.company.id,
              title: job.company.title,
              website: job.company.website ?? null,
              openings: 1,
            });
        }
        token = data.nextPageToken;
        if (!token) break;
      }
    }
  }
  if (answered === 0) return { ok: false, code: "failed" };

  const candidates: DiscoveryCandidate[] = [];
  const top = [...companies.values()]
    .sort((a, b) => b.openings - a.openings)
    .slice(0, MAX_DIRECTORY_COMPANIES);
  for (const company of top) {
    const slug = await boardOf(company, options);
    if (slug === null) continue;
    const careersUrl = canonicalBoardUrl("workable", slug);
    if (careersUrl === undefined) continue;
    candidates.push({ ats: "workable", slug, careersUrl, name: company.title });
  }
  return { ok: true, candidates, answered };
}
