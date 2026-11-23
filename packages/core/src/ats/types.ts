import type { HttpClient, HttpErrorCode } from "../net";
import type { NormalizedJob } from "../normalize";

export const ATS_IDS = [
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "smartrecruiters",
  "personio",
  "recruitee",
  "teamtailor",
] as const;
export type AtsId = (typeof ATS_IDS)[number];

/** One company board on an ATS. `slug` is the board token used in the provider's public API. */
export interface BoardRef {
  ats: AtsId;
  slug: string;
  /** Company name to use when the API does not send one. */
  companyName?: string;
}

export type AdapterFailureCode =
  | HttpErrorCode
  | "invalid-slug"
  | "invalid-response"
  | "too-many-pages"
  /** Generic careers pages: no AI provider is configured, or it failed. */
  | "ai-unavailable"
  /** The model reported that the listing continues (pagination, "load more"), so it is not complete. */
  | "incomplete-listing"
  /** The model found no postings on a generic careers page. Never treated as a complete empty scan. */
  | "no-parseable-jobs"
  /** The renderer could not load a JavaScript page. */
  | "render-failed";

export interface AdapterFailure {
  ok: false;
  code: AdapterFailureCode;
  url: string;
  status?: number;
}

/**
 * `ok: true` means the board was read completely: every page, no failure in between. Only a
 * complete scan may later mark jobs as closed, so a failure never returns partial jobs.
 */
export type AdapterResult = { ok: true; jobs: NormalizedJob[] } | AdapterFailure;

export interface FetchOptions {
  signal?: AbortSignal;
}

export interface AtsAdapter {
  readonly id: AtsId;
  fetchJobs(board: BoardRef, client: HttpClient, options?: FetchOptions): Promise<AdapterResult>;
}
