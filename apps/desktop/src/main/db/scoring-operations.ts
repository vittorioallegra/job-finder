import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { companies, jobScores, jobs } from "@job-finder/core";
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
          score: row.score,
          explanation: row.explanation,
          createdAt: row.createdAt,
        },
      });
  }
}

/** Open jobs to score when a run starts: the newest first. */
export async function openJobIds(db: AppDb, limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(isNull(jobs.closedAt))
    .orderBy(desc(jobs.firstSeenAt), jobs.title)
    .limit(limit);
  return rows.map((row) => row.id);
}
