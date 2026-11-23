import { z } from "zod";
import type { IngestEvent, IngestRunOutcome } from "@job-finder/core/ingest/events";

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

export const IngestCancelRequestSchema = z.strictObject({
  runId: z.string().min(1).max(64),
});

export interface CompanyRecord {
  id: string;
  name: string;
  careersUrl: string;
  /** The ATS id, e.g. "greenhouse"; null when no board was detected. */
  ats: string | null;
  slug: string | null;
  /** Epoch milliseconds. */
  createdAt: number;
}

/** Why a company could not be added. */
export type CompanyAddFailureCode = "unsupported-careers-url" | "duplicate-company";

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
  /** Epoch milliseconds. */
  firstSeenAt: number;
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
