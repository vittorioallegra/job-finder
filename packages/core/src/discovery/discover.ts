import { detectAtsFromUrl } from "../ats/detect";
import type { AtsId } from "../ats/types";
import { canonicalBoardUrl } from "./boards";
import { duckDuckGoSource } from "./duckduckgo";
import { buildQueries, MAX_QUERIES } from "./query";
import type { SearchSource } from "./source";
import type { DiscoveryCandidate, DiscoveryCriteria, DiscoveryOutcome } from "./types";
import type { HttpClient } from "../net";

export interface DiscoverOptions {
  http: HttpClient;
  /** Defaults to the keyless sources. */
  sources?: readonly SearchSource[];
  maxQueries?: number;
  signal?: AbortSignal;
}

/**
 * Searches for the criteria and returns the ATS boards named in the result URLs, one candidate per
 * board. A challenge stops the run at once, so the provider is not asked again. When no query
 * succeeds, the outcome says why.
 */
export async function discoverCompanies(
  criteria: DiscoveryCriteria,
  options: DiscoverOptions,
): Promise<DiscoveryOutcome> {
  const sources = options.sources ?? [duckDuckGoSource];
  const queries = buildQueries(criteria, options.maxQueries ?? MAX_QUERIES);
  const candidates: DiscoveryCandidate[] = [];
  const seen = new Set<string>();
  let succeeded = 0;
  let blocked = false;

  queryLoop: for (const query of queries) {
    for (const source of sources) {
      if (options.signal?.aborted) break queryLoop;
      const result = await source.search(query, { http: options.http, signal: options.signal });
      if (!result.ok) {
        if (result.code === "blocked" || result.code === "blocked-by-robots") {
          blocked = true;
          break queryLoop;
        }
        continue;
      }
      succeeded += 1;
      for (const url of result.urls) {
        const candidate = toCandidate(url);
        if (candidate && !seen.has(`${candidate.ats}/${candidate.slug}`)) {
          seen.add(`${candidate.ats}/${candidate.slug}`);
          candidates.push(candidate);
        }
      }
    }
  }

  if (succeeded > 0) return { ok: true, candidates };
  return { ok: false, code: blocked ? "search-blocked" : "search-failed" };
}

function toCandidate(url: string): DiscoveryCandidate | undefined {
  const detection = detectAtsFromUrl(url);
  if (!detection || detection.slug === undefined) return undefined;
  const ats: AtsId = detection.ats;
  const careersUrl = canonicalBoardUrl(ats, detection.slug);
  if (careersUrl === undefined) return undefined;
  return { ats, slug: detection.slug, careersUrl, name: detection.slug };
}
