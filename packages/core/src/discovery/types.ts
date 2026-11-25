// Pure types shared by the engine, main and the renderer bridge. No imports, so the bridge can use them without loading core.

/** What to search for. Keywords and locations are combined with each ATS board domain. */
export interface DiscoveryCriteria {
  keywords: string[];
  locations: string[];
  /** Hosts of the companies already followed: sources that look companies up skip them. */
  known?: string[];
}

/** A posting a job directory gave, in the normalized shape the job store takes. */
export type DirectoryJob = import("../normalize").NormalizedJob;

/** A board found in search results, with the URL the scan will use. */
export interface DiscoveryCandidate {
  /** ATS id, e.g. "greenhouse"; null for a company's own careers page that names no ATS. */
  ats: string | null;
  /** Board token used by the provider's public API; null with a careers page. */
  slug: string | null;
  /** Canonical board address for this ATS and slug; detection maps it back to the same board. */
  careersUrl: string;
  /** Placeholder name: the board token. The user can rename the company after adding it. */
  name: string;
}

/**
 * `search-blocked`: the search provider refused automated requests (a bot challenge or robots.txt).
 * `search-failed`: every query failed for another reason (network, status, size, timeout).
 */
export type DiscoveryFailureCode = "search-blocked" | "search-failed";

/**
 * `searchBlocked` is set when a keyless search source was refused but other sources still produced
 * boards, so the screen can say that keyless search is not working.
 */
export type DiscoveryOutcome =
  | {
      ok: true;
      candidates: DiscoveryCandidate[];
      searchBlocked?: true;
      /** Open postings read straight from job directories, stored by main without a board scan. */
      jobs?: DirectoryJob[];
    }
  | { ok: false; code: DiscoveryFailureCode };

/** Keyed search providers. A provider runs only with its toggle on and a key saved. */
export const KEYED_PROVIDERS = ["brave", "tavily", "serper"] as const;
export type KeyedProvider = (typeof KEYED_PROVIDERS)[number];

export interface KeyedSearchConfig {
  provider: KeyedProvider;
  apiKey: string;
}

/** Which search sources run for a discovery: DuckDuckGo when its toggle is on, plus each keyed provider. */
export interface SearchSourceConfig {
  duckduckgo: boolean;
  keyed: KeyedSearchConfig[];
}
