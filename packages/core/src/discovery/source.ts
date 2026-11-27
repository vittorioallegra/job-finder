import type { HttpClient, HttpErrorCode } from "../net";

/** `quota-exhausted`: a keyed provider refused the key (plan used up, rate limit or key not accepted). */
export type SearchFailureCode = "blocked" | "invalid-response" | "quota-exhausted" | HttpErrorCode;

/**
 * `degraded` is set when a source tried before the one that answered was refused (a bot challenge
 * or a used-up plan), so the screen can say that the preferred service is not working.
 */
export type SearchResult =
  { ok: true; urls: string[]; degraded?: true } | { ok: false; code: SearchFailureCode };

export interface SearchOptions {
  http: HttpClient;
  signal?: AbortSignal;
}

/**
 * A web search provider. Each source turns one query into result URLs; discovery reads the boards
 * from those URLs. A keyed provider (step 11) is another source with the same shape.
 */
export interface SearchSource {
  readonly id: string;
  search(query: string, options: SearchOptions): Promise<SearchResult>;
}

/**
 * A keyless list of result URLs that does not depend on the query, such as an index of crawled
 * pages. Discovery reads it once per run and keeps the boards in it.
 */
export interface BoardSource {
  readonly id: string;
  urls(options: SearchOptions): Promise<SearchResult>;
}
