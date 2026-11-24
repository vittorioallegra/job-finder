import { z } from "zod";
import type { IngestEvent, IngestRunOutcome } from "@job-finder/core/ingest/events";
import type { ApplicationStatus } from "@job-finder/core/applications";

/** Main pushes run progress on this channel; the renderer receives it through `ingest.onProgress`. */
export const INGEST_PROGRESS_CHANNEL = "ingest:progress";

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export const CompanyAddRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  careersUrl: z
    .string()
    .trim()
    .max(2048)
    .refine(isHttpUrl, "The careers URL must be an http or https address"),
});

export type CompanyAddRequest = z.input<typeof CompanyAddRequestSchema>;

export const CompanyRemoveRequestSchema = z.strictObject({
  companyId: z.string().min(1).max(64),
});

export type CompanyRemoveRequest = z.input<typeof CompanyRemoveRequestSchema>;

export const IngestCancelRequestSchema = z.strictObject({
  runId: z.string().min(1).max(64),
});

/** Omitted: scan every company. Given: scan only that company (a retry). */
export const IngestStartRequestSchema = z
  .strictObject({
    companyId: z.string().min(1).max(64),
  })
  .optional();

export type IngestStartRequest = z.input<typeof IngestStartRequestSchema>;

/** The company's latest scan in the run log: a complete read (with its postings) or a failure code. */
export type CompanyScan =
  | { outcome: "scanned"; at: number; jobCount: number; closedCount: number }
  | { outcome: "failed"; at: number; code: string };

export interface CompanyRecord {
  id: string;
  name: string;
  careersUrl: string;
  /** The ATS id, e.g. "greenhouse"; null when no board was detected. */
  ats: string | null;
  slug: string | null;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Null before the company was ever scanned. */
  lastScan: CompanyScan | null;
}

/** Why a company could not be added. Any http(s) careers page is accepted; only a duplicate is refused. */
export type CompanyAddFailureCode = "duplicate-company";

export type CompanyAddResult =
  { ok: true; company: CompanyRecord } | { ok: false; code: CompanyAddFailureCode };

/** Why a run could not start: another one is active, or the engine could not be reached. */
export type IngestStartFailureCode = "already-running" | "engine-unavailable";

export type IngestStartResult =
  { ok: true; runId: string } | { ok: false; code: IngestStartFailureCode };

export interface JobListItem {
  id: string;
  title: string;
  companyName: string;
  /** The locations as the sources wrote them. */
  locations: string[];
  workMode: string;
  url: string;
  applyUrl: string;
  /** Epoch milliseconds, from the posting's own date when the source gives one. */
  postedAt: number | null;
  /** Epoch milliseconds. */
  firstSeenAt: number;
  /** The affinity score 0-100 for the current profile version, or null when the job is not scored. */
  score: number | null;
  /** The model's explanation of the score, or null when the job is not scored. */
  explanation: string | null;
  /** The user dismissed the job. */
  dismissed: boolean;
  /** The user has not opened the job yet. */
  isNew: boolean;
  /** The status of the job's latest application, or null when it has none (a bookmark is "bookmarked"). */
  applicationStatus: ApplicationStatus | null;
}

export interface RunSummary {
  id: string;
  kind: string;
  status: string;
  /** Epoch milliseconds. */
  startedAt: number;
  finishedAt: number | null;
}

/** The latest ingestion run with its log, in event order. */
export interface LatestRun {
  run: RunSummary;
  events: IngestEvent[];
}

export type { IngestEvent, IngestRunOutcome };
