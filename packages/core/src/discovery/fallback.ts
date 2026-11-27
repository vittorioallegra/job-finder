import type { SearchFailureCode, SearchOptions, SearchResult, SearchSource } from "./source";

/** A source that was refused is left alone for this long: a challenge wears off, a plan resets. */
export const BLOCKED_REST_MS = 20 * 60 * 1000;
export const QUOTA_REST_MS = 60 * 60 * 1000;

/**
 * Requests to the keyed sources one run may make by default: a run asks the web many questions,
 * and a free plan holds a thousand a month.
 */
export const KEYED_REQUESTS_PER_RUN = 20;

/** Sources that refused lately, by id: kept between runs, since each run builds its sources again. */
const resting = new Map<string, { until: number; code: SearchFailureCode }>();

/** Forgets which sources were refused: for tests. */
export function resetFallbackState(): void {
  resting.clear();
}

/**
 * One source made of several, tried in order for every query: the first that answers wins, so the
 * free source (DuckDuckGo) takes every query it can and the keyed providers only the ones it
 * cannot. A source that answers with a bot challenge or has no quota left is not asked again for a
 * while. The answer says `degraded` when an earlier source was refused. When none answers, the
 * failure is `blocked` if any source was blocked (so the screen can say so), else the last one.
 */
export function createFallbackSource(
  sources: readonly SearchSource[],
  options: { now?: () => number; keyedBudget?: number } = {},
): SearchSource {
  const now = options.now ?? Date.now;
  // Requests this source may send to the sources after the first: each costs a unit of a monthly plan.
  let budget = options.keyedBudget ?? Number.POSITIVE_INFINITY;
  return {
    id: `fallback-${sources.map((source) => source.id).join("+")}`,
    async search(query: string, searchOptions: SearchOptions): Promise<SearchResult> {
      let refused: SearchFailureCode | undefined;
      let failure: SearchFailureCode | undefined;
      for (const [index, source] of sources.entries()) {
        const paid = index > 0;
        if (paid && budget <= 0) continue;
        const rest = resting.get(source.id);
        if (rest !== undefined && rest.until > now()) {
          refused = refused ?? rest.code;
          continue;
        }
        if (paid) budget -= 1;
        const result = await source.search(query, searchOptions);
        if (result.ok) return refused === undefined ? result : { ...result, degraded: true };
        failure = result.code;
        if (result.code === "blocked" || result.code === "blocked-by-robots") {
          resting.set(source.id, { until: now() + BLOCKED_REST_MS, code: result.code });
          refused = refused ?? result.code;
        } else if (result.code === "quota-exhausted") {
          resting.set(source.id, { until: now() + QUOTA_REST_MS, code: result.code });
          refused = refused ?? result.code;
        }
      }
      const blocked = refused === "blocked" || refused === "blocked-by-robots";
      return {
        ok: false,
        code: blocked ? (refused as SearchFailureCode) : (failure ?? refused ?? "network"),
      };
    },
  };
}
