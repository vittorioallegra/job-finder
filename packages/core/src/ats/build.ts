import { z } from "zod";
import {
  detectLanguage,
  employmentTypeFrom,
  normalizeLocation,
  parseSalaryText,
  remoteScopeFrom,
  remoteScopeFromDescription,
  resolveWorkMode,
  seniorityFrom,
  visaSponsorshipFrom,
  type JobLocation,
  type NormalizedJob,
} from "../normalize";
import type { BoardRef } from "./types";

export interface JobInput {
  source: string;
  sourceJobId: string;
  url: string;
  applyUrl?: string;
  companyName: string;
  title: string;
  /** Plain text. */
  description: string;
  locations: JobLocation[];
  /** Structured workplace values, most specific first. */
  workModeHints?: (string | undefined)[];
  /** Structured employment label, e.g. "Full-time". */
  employmentLabel?: string;
  /** Structured seniority label, e.g. "Mid-Senior Level". */
  seniorityLabel?: string;
  postedAt?: string;
}

/**
 * Builds a normalized job from what one source sent. Structured values win; the title and the
 * location text come next. Salary and visa are read from the description only when it states them.
 */
export function buildJob(input: JobInput): NormalizedJob {
  const employmentType = employmentTypeFrom(input.employmentLabel);
  const job: NormalizedJob = {
    source: input.source,
    sourceJobId: input.sourceJobId,
    url: input.url,
    applyUrl: input.applyUrl ?? input.url,
    companyName: input.companyName,
    title: input.title,
    description: input.description,
    locations: input.locations,
    workMode: resolveWorkMode(
      ...(input.workModeHints ?? []),
      input.title,
      ...input.locations.map((location) => location.raw),
    ),
    employmentType: employmentType !== "unknown" ? employmentType : employmentTypeFrom(input.title),
    seniority: seniorityFrom(`${input.title} ${input.seniorityLabel ?? ""}`),
    visaSponsorship: visaSponsorshipFrom(input.description),
  };
  const remoteScope = input.locations
    .map((location) => remoteScopeFrom(location.raw))
    .find((scope) => scope !== undefined);
  if (remoteScope !== undefined) {
    job.remoteScope = remoteScope;
  } else if (job.workMode === "remote") {
    // "Remote" with no stated scope: the description may tie the job to a country.
    const described = remoteScopeFromDescription(input.description);
    if (described !== undefined) job.remoteScope = described;
  }
  const salary = parseSalaryText(input.description);
  if (salary !== undefined) job.salary = salary;
  const language = detectLanguage(input.description);
  if (language !== undefined) job.language = language;
  if (input.postedAt !== undefined) job.postedAt = input.postedAt;
  return job;
}

/** Location list from raw strings. Empty and duplicate values are dropped. */
export function locationsFromText(values: readonly (string | null | undefined)[]): JobLocation[] {
  const seen = new Set<string>();
  const locations: JobLocation[] = [];
  for (const value of values) {
    const raw = value?.trim();
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    locations.push(normalizeLocation(raw));
  }
  return locations;
}

export function companyOf(board: BoardRef, name?: string | null): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  return board.companyName?.trim() || board.slug;
}

/** ISO 8601 string, or undefined when the source value is missing or not a date. */
export function toIso(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Parses a JSON body against a schema. Undefined when either step fails. */
export function parseJson<T>(body: string, schema: z.ZodType<T>): T | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
}
