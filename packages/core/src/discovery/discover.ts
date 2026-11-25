import { detectAtsFromUrl } from "../ats/detect";
import type { AtsId } from "../ats/types";
import { canonicalBoardUrl } from "./boards";
import { commonCrawlSource } from "./commoncrawl";
import { duckDuckGoSource } from "./duckduckgo";
import { createKeyedSource } from "./keyed";
import { discoverFromFeeds, KEYLESS_FEEDS, type JobFeed } from "./feeds";
import { discoverFromRegistry } from "./registry";
import { directoryJobs } from "./directory-jobs";
import { arbeitnowJobs, himalayasJobs } from "./feed-jobs";
import { wideScan } from "./wide-scan";
import { discoverWorkableDirectory } from "./workable-directory";
import { buildQueries, MAX_QUERIES } from "./query";
import type { BoardSource, SearchSource } from "./source";
import type {
  DirectoryJob,
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
  /** Whether Workable's job directory is asked which companies hire in the places. Defaults to yes. */
  directories?: boolean;
  /** Job feeds that name hiring companies. Defaults to the keyless ones. */
  feeds?: readonly JobFeed[];
  /** Whether DBpedia is asked for the companies of the places' countries. Defaults to yes. */
  registry?: boolean;
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
  if (criteria.postings) {
    // The postings of the job directories, ready to store. A run of its own: it reads many pages.
    const read = { http: options.http, signal: options.signal };
    const jobs: DirectoryJob[] = [
      ...(await directoryJobs(criteria, read)),
      ...(await himalayasJobs(criteria, read)),
      ...(await arbeitnowJobs(criteria, read)),
    ];
    return { ok: true, candidates: [], ...(jobs.length > 0 ? { jobs } : {}) };
  }
  if (criteria.wide) {
    const wide = await wideScan(criteria, { http: options.http, signal: options.signal });
    if (wide === undefined) return { ok: false, code: "search-failed" };
    return {
      ok: true,
      candidates: [],
      wideNext: wide.next,
      wideChecked: wide.checked,
      ...(wide.jobs.length > 0 ? { jobs: wide.jobs } : {}),
    };
  }
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
      const key = candidate && `${candidate.ats}/${candidate.slug}`;
      if (candidate && key && !seen.has(key)) {
        seen.add(key);
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

  // Companies hiring in the criteria's places, from Workable's public directory: it knows the place,
  // which a web search for the same words does not.
  if (options.directories !== false && !options.signal?.aborted) {
    const directory = await discoverWorkableDirectory(criteria, {
      http: options.http,
      signal: options.signal,
    });
    if (directory.ok) {
      if (directory.answered > 0) succeeded += 1;
      for (const candidate of directory.candidates) {
        const key = `${candidate.ats}/${candidate.slug}`;
        if (seen.has(key)) {
          // Found by search too: keep its proper name instead of the board token.
          const existing = candidates.find((item) => `${item.ats}/${item.slug}` === key);
          if (existing) existing.name = candidate.name;
          continue;
        }
        seen.add(key);
        candidates.push(candidate);
      }
    }
  }

  // Companies of the places' countries from DBpedia, each with the careers page its site shows.
  if (options.registry !== false && !options.signal?.aborted) {
    const registry = await discoverFromRegistry(criteria, {
      http: options.http,
      signal: options.signal,
    });
    if (registry.answered > 0) succeeded += 1;
    for (const candidate of registry.candidates) {
      const key = `${candidate.ats ?? "page"}/${candidate.slug ?? candidate.careersUrl}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
    }
  }

  // Companies named by public job APIs that need no key: each name is
  // turned into a board and checked to be that company's.
  if (!options.signal?.aborted) {
    const feeds = options.feeds ?? KEYLESS_FEEDS;
    const fromFeeds = await discoverFromFeeds(criteria, feeds, {
      http: options.http,
      signal: options.signal,
    });
    if (fromFeeds.answered > 0) succeeded += 1;
    for (const candidate of fromFeeds.candidates) {
      const key = `${candidate.ats}/${candidate.slug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
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
