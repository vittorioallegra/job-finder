import { ATS_IDS, type AtsId } from "../ats/types";
import type { DiscoveryCriteria } from "./types";

/** Domains each ATS serves its public boards from. `site:` matches subdomains too. */
export const ATS_SEARCH_SITES: Record<AtsId, readonly string[]> = {
  greenhouse: ["boards.greenhouse.io", "job-boards.greenhouse.io"],
  lever: ["jobs.lever.co"],
  ashby: ["jobs.ashbyhq.com"],
  workable: ["apply.workable.com"],
  smartrecruiters: ["jobs.smartrecruiters.com"],
  personio: ["jobs.personio.de", "jobs.personio.com"],
  recruitee: ["recruitee.com"],
  teamtailor: ["teamtailor.com"],
};

/**
 * Caps the queries of one discovery run. Each query is one request to the search provider, and
 * the HTTP queue spaces them one second apart.
 */
export const MAX_QUERIES = 12;

const MAX_TERM_LENGTH = 100;

/** A phrase in double quotes, with quotes and operators inside the term removed. */
function phrase(term: string): string {
  return `"${term.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TERM_LENGTH)}"`;
}

/**
 * One query per keyword, location and ATS: `"keyword" "location" (site:a OR site:b)`. Keywords come
 * first, so the cap drops the last combinations rather than a whole keyword.
 */
export function buildQueries(criteria: DiscoveryCriteria, maxQueries = MAX_QUERIES): string[] {
  const keywords = criteria.keywords.map((term) => term.trim()).filter((term) => term !== "");
  const locations = criteria.locations.map((term) => term.trim()).filter((term) => term !== "");
  const queries: string[] = [];
  for (const keyword of keywords) {
    for (const location of locations.length > 0 ? locations : [undefined]) {
      for (const ats of ATS_IDS) {
        if (queries.length >= maxQueries) return queries;
        const sites = ATS_SEARCH_SITES[ats].map((site) => `site:${site}`).join(" OR ");
        const terms = [phrase(keyword), location === undefined ? "" : phrase(location)];
        queries.push(`${terms.filter((term) => term !== "").join(" ")} (${sites})`);
      }
    }
  }
  return queries;
}
