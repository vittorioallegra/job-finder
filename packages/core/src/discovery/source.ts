import type { HttpClient, HttpErrorCode } from "../net";

export type SearchFailureCode = "blocked" | HttpErrorCode;

export type SearchResult = { ok: true; urls: string[] } | { ok: false; code: SearchFailureCode };

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
