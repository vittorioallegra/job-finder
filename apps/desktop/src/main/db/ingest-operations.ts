import { and, asc, eq, inArray, isNull, ne, notLike, sql } from "drizzle-orm";
import { companies, jobSources, jobs, runEvents } from "@job-finder/core";
import type { BatchPlan, ExistingState, LookupRequest } from "@job-finder/core/ingest";
import type { IngestEvent } from "@job-finder/core/ingest/events";
import { identityKey } from "@job-finder/core/normalize";
import type { AppDb } from "./operations";

/** Companies the engine scans, in the order they were added. */
export async function listCompanyRows(db: AppDb) {
  return (
    db
      .select({
        id: companies.id,
        name: companies.name,
        careersUrl: companies.careersUrl,
        ats: companies.ats,
        slug: companies.slug,
      })
      .from(companies)
      // A company removed from the sources is not scanned.
      .where(and(isNull(companies.excludedAt), notLike(companies.careersUrl, "directory:%")))
      .orderBy(asc(companies.createdAt))
  );
}

/**
 * Reads what the store already holds for one batch: jobs with the same fingerprint (with the
 * sources that report them) and the source rows of the postings in the batch.
 */
export async function lookupExisting(db: AppDb, request: LookupRequest): Promise<ExistingState> {
  const jobRows =
    request.fingerprints.length === 0
      ? []
      : await db
          .select({ id: jobs.id, fingerprint: jobs.fingerprint })
          .from(jobs)
          .where(inArray(jobs.fingerprint, request.fingerprints));

  const wanted = new Set(request.sources.map((source) => identityKey(source)));
  const sourceIds = [...new Set(request.sources.map((source) => source.sourceJobId))];
  const knownRows =
    sourceIds.length === 0
      ? []
      : await db
          .select({
            source: jobSources.source,
            sourceJobId: jobSources.sourceJobId,
            jobId: jobSources.jobId,
          })
          .from(jobSources)
          .where(inArray(jobSources.sourceJobId, sourceIds));
  const sources = knownRows.filter((row) => wanted.has(identityKey(row)));

  const jobIds = [
    ...new Set([...jobRows.map((row) => row.id), ...sources.map((row) => row.jobId)]),
  ];
  const linked =
    jobIds.length === 0
      ? []
      : await db
          .select({ jobId: jobSources.jobId, source: jobSources.source })
          .from(jobSources)
          .where(inArray(jobSources.jobId, jobIds));
  const sourcesByJob = new Map<string, string[]>();
  for (const row of linked) {
    const list = sourcesByJob.get(row.jobId);
    if (list) list.push(row.source);
    else sourcesByJob.set(row.jobId, [row.source]);
  }

  return {
    jobs: jobRows.map((row) => ({
      id: row.id,
      fingerprint: row.fingerprint,
      sources: sourcesByJob.get(row.id) ?? [],
    })),
    sources,
  };
}

function parseTime(value: string | undefined): number | null {
  if (value === undefined) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/** Writes one planned batch: new jobs, reseen jobs, then the source rows that point at them. */
export async function persistPlan(db: AppDb, plan: BatchPlan): Promise<void> {
  for (const insert of plan.inserts) {
    const job = insert.job;
    await db.insert(jobs).values({
      id: insert.id,
      companyId: insert.companyId,
      fingerprint: insert.fingerprint,
      title: job.title,
      description: job.description,
      url: job.url,
      applyUrl: job.applyUrl,
      language: job.language ?? null,
      locations: JSON.stringify(job.locations),
      workMode: job.workMode,
      remoteScope: job.remoteScope ?? null,
      employmentType: job.employmentType,
      seniority: job.seniority,
      salary: job.salary ? JSON.stringify(job.salary) : null,
      visaSponsorship: job.visaSponsorship,
      postedAt: parseTime(job.postedAt),
      firstSeenAt: plan.seenAt,
      lastSeenAt: plan.seenAt,
      closedAt: null,
    });
  }

  if (plan.touches.length > 0) {
    await db
      .update(jobs)
      .set({ lastSeenAt: plan.seenAt, closedAt: null })
      .where(inArray(jobs.id, plan.touches));
  }

  for (const update of plan.updates) {
    const job = update.job;
    await db
      .update(jobs)
      .set({
        fingerprint: update.fingerprint,
        title: job.title,
        description: job.description,
        url: job.url,
        applyUrl: job.applyUrl,
        language: job.language ?? null,
        locations: JSON.stringify(job.locations),
        workMode: job.workMode,
        remoteScope: job.remoteScope ?? null,
        employmentType: job.employmentType,
        seniority: job.seniority,
        salary: job.salary ? JSON.stringify(job.salary) : null,
        visaSponsorship: job.visaSponsorship,
        postedAt: parseTime(job.postedAt),
      })
      .where(eq(jobs.id, update.id));
  }

  for (const source of plan.sources) {
    await db
      .insert(jobSources)
      .values({
        source: source.source,
        sourceJobId: source.sourceJobId,
        jobId: source.jobId,
        companyId: source.companyId,
        url: source.url,
        applyUrl: source.applyUrl,
        lastRunId: source.runId,
        firstSeenAt: plan.seenAt,
        lastSeenAt: plan.seenAt,
        closedAt: null,
      })
      .onConflictDoUpdate({
        target: [jobSources.source, jobSources.sourceJobId],
        set: {
          jobId: source.jobId,
          companyId: source.companyId,
          url: source.url,
          applyUrl: source.applyUrl,
          lastRunId: source.runId,
          lastSeenAt: plan.seenAt,
          closedAt: null,
        },
      });
  }
}

/**
 * Closes the source rows of one company that the run did not see, then closes every job whose
 * sources are all closed. Only called after a complete scan. Returns the number of source rows closed.
 */
export async function closeMissingSources(
  db: AppDb,
  companyId: string,
  runId: string,
  at: number,
): Promise<number> {
  const missing = and(
    eq(jobSources.companyId, companyId),
    ne(jobSources.lastRunId, runId),
    isNull(jobSources.closedAt),
  );
  const open = await db.select({ jobId: jobSources.jobId }).from(jobSources).where(missing);
  if (open.length === 0) return 0;

  await db.update(jobSources).set({ closedAt: at }).where(missing);
  await db
    .update(jobs)
    .set({ closedAt: at })
    .where(
      and(
        isNull(jobs.closedAt),
        sql`not exists (select 1 from ${jobSources} where ${jobSources.jobId} = ${jobs.id} and ${jobSources.closedAt} is null)`,
      ),
    );
  return open.length;
}

/** Stores one run log entry. The fields that are not common to every event go into `detail`. */
export async function appendRunEvent(db: AppDb, event: IngestEvent): Promise<void> {
  const { runId, seq, at, kind, ...detail } = event;
  await db.insert(runEvents).values({ runId, seq, at, kind, detail: JSON.stringify(detail) });
}
