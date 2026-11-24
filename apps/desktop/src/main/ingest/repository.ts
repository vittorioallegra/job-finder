import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  applications,
  companies,
  jobFlags,
  jobScores,
  jobSources,
  jobs,
  profile,
  runEvents,
  runs,
} from "@job-finder/core";
import { detectAts } from "@job-finder/core/ats";
import { INGEST_RUN_KIND, type IngestEvent } from "@job-finder/core/ingest/events";
import { JobFilterSchema } from "@job-finder/core/filters";
import { jobFilterCondition } from "@job-finder/core/filters/sql";
import type { ApplicationStatus } from "@job-finder/core/applications";
import type { Salary } from "@job-finder/core/normalize";
import type {
  CompanyAddResult,
  CompanyRecord,
  CompanyScan,
  JobDetail,
  JobFlagRequest,
  JobListItem,
  JobsListRequest,
  LatestRun,
} from "@job-finder/bridge";
import type { AppDb } from "../db/operations";

export interface AddCompanyInput {
  name: string;
  careersUrl: string;
  /**
   * The user added it by hand: a company removed earlier comes back. The company search leaves it
   * unset, so a removed company is not added again.
   */
  restore?: boolean;
}

export interface IngestRepository {
  listCompanies(): Promise<CompanyRecord[]>;
  /** Detects the ATS board from the careers URL (no network) and stores the company. */
  addCompany(input: AddCompanyInput, now?: number, newId?: () => string): Promise<CompanyAddResult>;
  /**
   * Removes a company from the sources: it is no longer scanned and its jobs leave the lists. The
   * row stays, so applications keep their jobs and the company search does not add it again.
   * Resolves false when it does not exist.
   */
  removeCompany(companyId: string, now?: number): Promise<boolean>;
  /**
   * Open jobs matching the request. By affinity (the default), highest first, with the jobs
   * without a score for the current profile version last; by newest, the latest posting first.
   */
  listJobs(request?: JobsListRequest, now?: number, limit?: number): Promise<JobListItem[]>;
  /** One job with its source links, open or closed; null when it does not exist. */
  jobDetail(jobId: string, now?: number): Promise<JobDetail | null>;
  /**
   * Dismisses or restores a job, or marks it viewed. Resolves false when the job does not exist.
   * A flag that is not in the request keeps its value.
   */
  setJobFlag(request: JobFlagRequest, now?: number): Promise<boolean>;
  /** The latest ingestion run with its log, or null when none has run. */
  latestRun(): Promise<LatestRun | null>;
}

/** The status of a job's latest application (by its last status change), or null when it has none. */
const LATEST_APPLICATION_STATUS = sql<ApplicationStatus | null>`(select ${applications.status} from ${applications} where ${applications.jobId} = ${jobs.id} order by ${applications.statusChangedAt} desc limit 1)`;

/** The newest first key of a job: its posting date, or when the job was first seen. */
const NEWEST = sql`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt})`;

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
      const rows = await db
        .select()
        .from(companies)
        .where(isNull(companies.excludedAt))
        .orderBy(asc(companies.createdAt));
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
      // A supported board is read through its ATS API; any other careers page is read with the AI.
      const detection = detectAts({ url: input.careersUrl });
      let board: { ats: string; slug: string } | undefined;
      if (detection?.slug !== undefined) board = { ats: detection.ats, slug: detection.slug };
      // One board is one company: the same URL, or the same ATS and board token under another URL.
      const [existing] = await db
        .select()
        .from(companies)
        .where(
          board
            ? or(
                eq(companies.careersUrl, input.careersUrl),
                and(eq(companies.ats, board.ats), eq(companies.slug, board.slug)),
              )
            : eq(companies.careersUrl, input.careersUrl),
        )
        .limit(1);
      if (existing) {
        if (existing.excludedAt === null || !input.restore) {
          return { ok: false, code: "duplicate-company" };
        }
        await db.update(companies).set({ excludedAt: null }).where(eq(companies.id, existing.id));
        const scans = await latestScans(db);
        return {
          ok: true,
          company: {
            id: existing.id,
            name: existing.name,
            careersUrl: existing.careersUrl,
            ats: existing.ats,
            slug: existing.slug,
            createdAt: existing.createdAt,
            lastScan: scans.get(existing.id) ?? null,
          },
        };
      }
      const row = {
        id: newId(),
        name: input.name,
        careersUrl: input.careersUrl,
        ats: board?.ats ?? null,
        slug: board?.slug ?? null,
        createdAt: now,
      };
      await db.insert(companies).values(row);
      return { ok: true, company: { ...row, lastScan: null } };
    },

    async removeCompany(companyId, now = Date.now()) {
      const updated = await db
        .update(companies)
        .set({ excludedAt: now })
        .where(eq(companies.id, companyId))
        .returning({ id: companies.id });
      return updated.length > 0;
    },

    async listJobs(request = { filter: {}, sort: "affinity" }, now = Date.now(), limit = 200) {
      // Scores of the current profile version only: a new version starts unscored until the next run.
      const currentVersion = sql`(select ${profile.version} from ${profile} where ${profile.id} = 1)`;
      const condition = jobFilterCondition(JobFilterSchema.parse(request.filter), now);
      const rows = await db
        .select({
          id: jobs.id,
          title: jobs.title,
          companyName: companies.name,
          locations: jobs.locations,
          workMode: jobs.workMode,
          url: jobs.url,
          applyUrl: jobs.applyUrl,
          postedAt: jobs.postedAt,
          firstSeenAt: jobs.firstSeenAt,
          score: jobScores.score,
          explanation: jobScores.explanation,
          dismissedAt: jobFlags.dismissedAt,
          viewedAt: jobFlags.viewedAt,
          applicationStatus: LATEST_APPLICATION_STATUS,
        })
        .from(jobs)
        .innerJoin(companies, eq(jobs.companyId, companies.id))
        .leftJoin(
          jobScores,
          and(eq(jobScores.jobId, jobs.id), eq(jobScores.profileVersion, currentVersion)),
        )
        .leftJoin(jobFlags, eq(jobFlags.jobId, jobs.id))
        .where(and(isNull(jobs.closedAt), condition))
        .orderBy(
          ...(request.sort === "newest"
            ? [desc(NEWEST), asc(jobs.title)]
            : [sql`${jobScores.score} desc nulls last`, desc(NEWEST), asc(jobs.title)]),
        )
        .limit(limit);
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        companyName: row.companyName,
        locations: parseLocations(row.locations),
        workMode: row.workMode,
        url: row.url,
        applyUrl: row.applyUrl,
        postedAt: row.postedAt,
        firstSeenAt: row.firstSeenAt,
        score: row.score,
        explanation: row.explanation,
        dismissed: row.dismissedAt !== null,
        isNew: row.viewedAt === null,
        applicationStatus: row.applicationStatus,
      }));
    },

    async jobDetail(jobId) {
      const currentVersion = sql`(select ${profile.version} from ${profile} where ${profile.id} = 1)`;
      const [row] = await db
        .select({
          id: jobs.id,
          title: jobs.title,
          companyName: companies.name,
          locations: jobs.locations,
          workMode: jobs.workMode,
          url: jobs.url,
          applyUrl: jobs.applyUrl,
          postedAt: jobs.postedAt,
          firstSeenAt: jobs.firstSeenAt,
          description: jobs.description,
          employmentType: jobs.employmentType,
          seniority: jobs.seniority,
          salary: jobs.salary,
          visaSponsorship: jobs.visaSponsorship,
          language: jobs.language,
          remoteScope: jobs.remoteScope,
          closedAt: jobs.closedAt,
          score: jobScores.score,
          explanation: jobScores.explanation,
          dismissedAt: jobFlags.dismissedAt,
          viewedAt: jobFlags.viewedAt,
          applicationStatus: LATEST_APPLICATION_STATUS,
        })
        .from(jobs)
        .innerJoin(companies, eq(jobs.companyId, companies.id))
        .leftJoin(
          jobScores,
          and(eq(jobScores.jobId, jobs.id), eq(jobScores.profileVersion, currentVersion)),
        )
        .leftJoin(jobFlags, eq(jobFlags.jobId, jobs.id))
        .where(eq(jobs.id, jobId))
        .limit(1);
      if (!row) return null;

      const sources = await db
        .select()
        .from(jobSources)
        .where(eq(jobSources.jobId, jobId))
        .orderBy(asc(jobSources.source));
      return {
        id: row.id,
        title: row.title,
        companyName: row.companyName,
        locations: parseLocations(row.locations),
        workMode: row.workMode,
        url: row.url,
        applyUrl: row.applyUrl,
        postedAt: row.postedAt,
        firstSeenAt: row.firstSeenAt,
        score: row.score,
        explanation: row.explanation,
        dismissed: row.dismissedAt !== null,
        isNew: row.viewedAt === null,
        applicationStatus: row.applicationStatus,
        description: row.description,
        employmentType: row.employmentType,
        seniority: row.seniority,
        salary: row.salary === null ? null : (JSON.parse(row.salary) as Salary),
        visaSponsorship: row.visaSponsorship,
        language: row.language,
        remoteScope: row.remoteScope,
        closedAt: row.closedAt,
        sources: sources.map((source) => ({
          source: source.source,
          url: source.url,
          applyUrl: source.applyUrl,
          closed: source.closedAt !== null,
          lastSeenAt: source.lastSeenAt,
        })),
      };
    },

    async setJobFlag(request, now = Date.now()) {
      const [job] = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(eq(jobs.id, request.jobId))
        .limit(1);
      if (!job) return false;

      const changes = {
        updatedAt: now,
        ...(request.dismissed === undefined ? {} : { dismissedAt: request.dismissed ? now : null }),
        ...(request.viewed === undefined ? {} : { viewedAt: request.viewed ? now : null }),
      };
      await db
        .insert(jobFlags)
        .values({
          jobId: request.jobId,
          dismissedAt: null,
          viewedAt: null,
          ...changes,
        })
        .onConflictDoUpdate({ target: jobFlags.jobId, set: changes });
      return true;
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
