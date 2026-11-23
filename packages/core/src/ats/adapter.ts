import type { NormalizedJob } from "../normalize";
import type { AdapterResult, AtsAdapter, AtsId, BoardRef, FetchOptions } from "./types";

/** Upper bound on pages per board. Hitting it is a failure, never a silent cut.  */
export const MAX_PAGES = 20;

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function isValidSlug(slug: string): boolean {
  return SLUG.test(slug);
}

export interface ParsedPage {
  jobs: NormalizedJob[];
  /** Absolute URL of the next page, when the API paginates. */
  next?: string;
}

export interface AdapterSpec {
  id: AtsId;
  endpoint(slug: string, offset?: number): string;
  /** Returns undefined when the body does not have the expected shape. */
  parse(body: string, board: BoardRef): ParsedPage | undefined;
}

/** Builds an adapter that reads every page of a board through the shared HTTP client. */
export function createAdapter(spec: AdapterSpec): AtsAdapter {
  return {
    id: spec.id,
    async fetchJobs(board, client, options?: FetchOptions): Promise<AdapterResult> {
      if (!isValidSlug(board.slug)) return { ok: false, code: "invalid-slug", url: "" };

      const jobs: NormalizedJob[] = [];
      let url: string | undefined = spec.endpoint(board.slug);
      for (let page = 0; url !== undefined; page++) {
        if (page === MAX_PAGES) return { ok: false, code: "too-many-pages", url };
        const response = await client.get(url, { signal: options?.signal });
        if (!response.ok) {
          const failure = { ok: false as const, code: response.code, url };
          return response.status === undefined ? failure : { ...failure, status: response.status };
        }
        const parsed = spec.parse(response.body, board);
        if (!parsed) return { ok: false, code: "invalid-response", url };
        jobs.push(...parsed.jobs);
        url = parsed.next;
      }
      return { ok: true, jobs };
    },
  };
}
