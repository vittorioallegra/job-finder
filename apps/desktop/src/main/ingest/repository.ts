import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { companies, jobs, runEvents, runs } from "@job-finder/core";
import { detectAts } from "@job-finder/core/ats";
import { INGEST_RUN_KIND, type IngestEvent } from "@job-finder/core/ingest/events";
import type {
  CompanyAddResult,
  CompanyRecord,
  CompanyScan,
  JobListItem,
  LatestRun,
} from "@job-finder/bridge";
import type { AppDb } from "../db/operations";

export interface AddCompanyInput {
  name: string;
  careersUrl: string;
}

export interface IngestRepository {
  listCompanies(): Promise<CompanyRecord[]>;
  /** Detects the ATS board from the careers URL (no network) and stores the company. */
  addCompany(input: AddCompanyInput, now?: number, newId?: () => string): Promise<CompanyAddResult>;
  /** Open jobs, newest first. */
  listJobs(limit?: number): Promise<JobListItem[]>;
  /** The latest ingestion run with its log, or null when none has run. */
  latestRun(): Promise<LatestRun | null>;
}

function parseLocations(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) =>
      typeof item === "object" && item !== null && "raw" in item ? String(item.raw) : "",
    );
  } catch {
    return [];
  }
}

const SCAN_EVENT_KINDS = ["company-scanned", "company-failed"];

/**
 * The latest scan of each company, read from the run log. Events are newest first, so the first
 * event of a company wins.
 */
async function latestScans(db: AppDb): Promise<Map<string, CompanyScan>> {
  const rows = await db
    .select({ kind: runEvents.kind, at: runEvents.at, detail: runEvents.detail })
    .from(runEvents)
    .where(inArray(runEvents.kind, SCAN_EVENT_KINDS))
    .orderBy(desc(runEvents.at), desc(runEvents.seq));
  const scans = new Map<string, CompanyScan>();
  for (const row of rows) {
    const detail = JSON.parse(row.detail) as Record<string, unknown>;
    const companyId = String(detail["companyId"]);
    if (scans.has(companyId)) continue;
    scans.set(
      companyId,
      row.kind === "company-scanned"
        ? {
            outcome: "scanned",
            at: row.at,
            jobCount: Number(detail["jobCount"]),
            closedCount: Number(detail["closedCount"]),
          }
        : { outcome: "failed", at: row.at, code: String(detail["code"]) },
    );
  }
  return scans;
}

export function createIngestRepository(db: AppDb): IngestRepository {
  return {
    async listCompanies() {
      const rows = await db.select().from(companies).orderBy(asc(companies.createdAt));
      const scans = await latestScans(db);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        careersUrl: row.careersUrl,
        ats: row.ats,
        slug: row.slug,
        createdAt: row.createdAt,
        lastScan: scans.get(row.id) ?? null,
      }));
    },

    async addCompany(input, now = Date.now(), newId = () => crypto.randomUUID()) {
      const detection = detectAts({ url: input.careersUrl });
      if (!detection || detection.slug === undefined) {
        return { ok: false, code: "unsupported-careers-url" };
      }
      // One board is one company: the same ATS and board token under another URL is a duplicate.
      const existing = await db
        .select({ id: companies.id })
        .from(companies)
        .where(and(eq(companies.ats, detection.ats), eq(companies.slug, detection.slug)))
        .limit(1);
      if (existing.length > 0) {
        return { ok: false, code: "duplicate-company" };
      }
      const row = {
        id: newId(),
        name: input.name,
        careersUrl: input.careersUrl,
        ats: detection.ats,
        slug: detection.slug,
        createdAt: now,
      };
      await db.insert(companies).values(row);
      return { ok: true, company: { ...row, lastScan: null } };
    },

    async listJobs(limit = 200) {
      const rows = await db
        .select({
          id: jobs.id,
          title: jobs.title,
          companyName: companies.name,
          locations: jobs.locations,
          workMode: jobs.workMode,
          url: jobs.url,
          applyUrl: jobs.applyUrl,
          firstSeenAt: jobs.firstSeenAt,
        })
        .from(jobs)
        .innerJoin(companies, eq(jobs.companyId, companies.id))
        .where(isNull(jobs.closedAt))
        .orderBy(desc(jobs.firstSeenAt), asc(jobs.title))
        .limit(limit);
      return rows.map((row) => ({ ...row, locations: parseLocations(row.locations) }));
    },

    async latestRun() {
      const [run] = await db
        .select()
        .from(runs)
        .where(eq(runs.kind, INGEST_RUN_KIND))
        .orderBy(desc(runs.startedAt))
        .limit(1);
      if (!run) return null;

      const rows = await db
        .select()
        .from(runEvents)
        .where(eq(runEvents.runId, run.id))
        .orderBy(asc(runEvents.seq));
      const events = rows.map((row) => {
        const detail = JSON.parse(row.detail) as Record<string, unknown>;
        return {
          ...detail,
          runId: row.runId,
          seq: row.seq,
          at: row.at,
          kind: row.kind,
        } as IngestEvent;
      });
      return {
        run: {
          id: run.id,
          kind: run.kind,
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
        },
        events,
      };
    },
  };
}
