import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { companies, jobScores, jobs, runs } from "@job-finder/core";
import { jobFilterCondition } from "@job-finder/core/filters/sql";
import type { JobFilter } from "@job-finder/core/filters";
import type { JobLocation, Salary } from "@job-finder/core/normalize";
import type { ScoringJob, StoredScore } from "@job-finder/core/ranking";
import type { AppDb } from "./operations";

function parseJson<T>(text: string | null, fallback: T): T {
  if (text === null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** The scoring inputs of the open jobs among `jobIds`. Unknown and closed jobs are left out. */
export async function loadScoringJobs(db: AppDb, jobIds: string[]): Promise<ScoringJob[]> {
  if (jobIds.length === 0) return [];
  const rows = await db
    .select({
      id: jobs.id,
      companyName: companies.name,
      title: jobs.title,
      description: jobs.description,
      locations: jobs.locations,
      workMode: jobs.workMode,
      remoteScope: jobs.remoteScope,
      employmentType: jobs.employmentType,
      seniority: jobs.seniority,
      salary: jobs.salary,
      visaSponsorship: jobs.visaSponsorship,
      language: jobs.language,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(and(inArray(jobs.id, jobIds), isNull(jobs.closedAt)));
  return rows.map((row) => ({
    ...row,
    locations: parseJson<JobLocation[]>(row.locations, []),
    salary: parseJson<Salary | null>(row.salary, null),
  }));
}

/** The stored scores of these jobs for one profile version. */
export async function lookupScores(
  db: AppDb,
  profileVersion: number,
  jobIds: string[],
): Promise<StoredScore[]> {
  if (jobIds.length === 0) return [];
  return db
    .select()
    .from(jobScores)
    .where(and(eq(jobScores.profileVersion, profileVersion), inArray(jobScores.jobId, jobIds)));
}

/** Stores scores, replacing the row of the same job and profile version. */
export async function persistScores(db: AppDb, rows: StoredScore[]): Promise<void> {
  for (const row of rows) {
    await db
      .insert(jobScores)
      .values(row)
      .onConflictDoUpdate({
        target: [jobScores.jobId, jobScores.profileVersion],
        set: {
          jobHash: row.jobHash,
          profileHash: row.profileHash,
          model: row.model,
          promptVersion: row.promptVersion,
          explanationLanguage: row.explanationLanguage,
          score: row.score,
          explanation: row.explanation,
          createdAt: row.createdAt,
        },
      });
  }
}

/**
 * The open jobs a scoring run may score: those that pass the hard filters, the jobs in
 * `preferredIds` (the visible ones) first, then the newest first.
 */
export async function scoringCandidateIds(
  db: AppDb,
  filter: JobFilter,
  preferredIds: string[],
  limit: number,
): Promise<string[]> {
  const newest = sql`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt}) desc`;
  const preferredFirst =
    preferredIds.length === 0
      ? []
      : [
          sql`case when ${jobs.id} in (${sql.join(
            preferredIds.map((id) => sql`${id}`),
            sql`, `,
          )}) then 0 else 1 end`,
        ];
  const rows = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(isNull(jobs.closedAt), jobFilterCondition(filter)))
    .orderBy(...preferredFirst, newest, jobs.title)
    .limit(limit);
  return rows.map((row) => row.id);
}

/** How many jobs were first seen since the run started: what a scan found that was not there before. */
export async function newJobsSinceRun(db: AppDb, runId: string): Promise<number> {
  const [run] = await db.select({ startedAt: runs.startedAt }).from(runs).where(eq(runs.id, runId));
  if (!run) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(jobs)
    .where(gte(jobs.firstSeenAt, run.startedAt));
  return Number(row?.count ?? 0);
}
