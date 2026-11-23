// Pure types shared by the engine, main and the renderer bridge. No imports, so the bridge can use them without loading core.

/** What to search for. Keywords and locations are combined with each ATS board domain. */
export interface DiscoveryCriteria {
  keywords: string[];
  locations: string[];
}

/** A board found in search results, with the URL the scan will use. */
export interface DiscoveryCandidate {
  /** ATS id, e.g. "greenhouse". */
  ats: string;
  /** Board token used by the provider's public API. */
  slug: string;
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

export type DiscoveryOutcome =
  { ok: true; candidates: DiscoveryCandidate[] } | { ok: false; code: DiscoveryFailureCode };
