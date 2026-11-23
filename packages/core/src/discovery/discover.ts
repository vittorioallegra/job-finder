import { detectAtsFromUrl } from "../ats/detect";
import type { AtsId } from "../ats/types";
import { canonicalBoardUrl } from "./boards";
import { commonCrawlSource } from "./commoncrawl";
import { duckDuckGoSource } from "./duckduckgo";
import { createKeyedSource } from "./keyed";
import { buildQueries, MAX_QUERIES } from "./query";
import type { BoardSource, SearchSource } from "./source";
import type {
  DiscoveryCandidate,
  DiscoveryCriteria,
  DiscoveryOutcome,
  SearchSourceConfig,
} from "./types";
import type { HttpClient } from "../net";

export interface DiscoverOptions {
  http: HttpClient;
  /** Search sources to run for every query. Defaults to the ones `config` enables. */
  sources?: readonly SearchSource[];
  /** Which search sources run when `sources` is not given. Defaults to DuckDuckGo only. */
  config?: SearchSourceConfig;
  /** Query-independent board lists, read once per run. Defaults to Common Crawl. */
  boardSources?: readonly BoardSource[];
  maxQueries?: number;
  signal?: AbortSignal;
}

const DEFAULT_CONFIG: SearchSourceConfig = { duckduckgo: true, keyed: [] };

/** The search sources a configuration enables: DuckDuckGo when its toggle is on, then each keyed provider. */
export function searchSourcesFor(config: SearchSourceConfig): SearchSource[] {
  return [...(config.duckduckgo ? [duckDuckGoSource] : []), ...config.keyed.map(createKeyedSource)];
}

/**
 * Searches for the criteria and returns the ATS boards named in the result URLs, one candidate per
 * board, plus the boards of the query-independent board sources. A source that answers with a
 * challenge is not asked again, and the other sources keep running. When no source succeeds, the
 * outcome says whether a source was blocked or the searches failed.
 */
export async function discoverCompanies(
  criteria: DiscoveryCriteria,
  options: DiscoverOptions,
): Promise<DiscoveryOutcome> {
  const sources = options.sources ?? searchSourcesFor(options.config ?? DEFAULT_CONFIG);
  const boardSources = options.boardSources ?? [commonCrawlSource];
  const queries = buildQueries(criteria, options.maxQueries ?? MAX_QUERIES);
  const candidates: DiscoveryCandidate[] = [];
  const seen = new Set<string>();
  const blockedSources = new Set<SearchSource>();
  let succeeded = 0;
  let blocked = false;

  const addUrls = (urls: string[]): void => {
    for (const url of urls) {
      const candidate = toCandidate(url);
      if (candidate && !seen.has(`${candidate.ats}/${candidate.slug}`)) {
        seen.add(`${candidate.ats}/${candidate.slug}`);
        candidates.push(candidate);
      }
    }
  };

  queryLoop: for (const query of queries) {
    for (const source of sources) {
      if (options.signal?.aborted) break queryLoop;
      if (blockedSources.has(source)) continue;
      const result = await source.search(query, { http: options.http, signal: options.signal });
      if (!result.ok) {
        if (result.code === "blocked" || result.code === "blocked-by-robots") {
          blocked = true;
          blockedSources.add(source);
        }
        continue;
      }
      succeeded += 1;
      addUrls(result.urls);
    }
    if (sources.length > 0 && blockedSources.size === sources.length) break;
  }

  for (const boardSource of boardSources) {
    if (options.signal?.aborted) break;
    const result = await boardSource.urls({ http: options.http, signal: options.signal });
    if (result.ok) {
      succeeded += 1;
      addUrls(result.urls);
    }
  }

  if (succeeded > 0) {
    return blocked ? { ok: true, candidates, searchBlocked: true } : { ok: true, candidates };
  }
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
