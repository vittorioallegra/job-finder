import { demoDataset } from "@job-finder/bridge/demo";
import {
  applicationEvents,
  applications,
  companies,
  jobFlags,
  jobScores,
  jobSources,
  jobs,
  profile,
  profileVersions,
  runEvents,
  runs,
} from "@job-finder/core";
import { scoringSnapshot } from "@job-finder/core/profile";
import { sql } from "drizzle-orm";
import type { AppDb } from "../db/operations";

/** Environment switch for the demo: development only, see `demoDataDirectory`. */
export const DEMO_ENV = "JOB_FINDER_DEMO";

/**
 * The userData folder for a demo session, or null when the demo is off. A packaged app never runs
 * the demo, and the demo never shares the user's real database: it gets a folder of its own.
 */
export function demoDataDirectory(
  env: NodeJS.ProcessEnv,
  isPackaged: boolean,
  userData: string,
): string | null {
  if (isPackaged || env[DEMO_ENV] !== "1") return null;
  return `${userData}-demo`;
}

/**
 * Fills an empty database with the shared sample data. Does nothing when any company exists, so a
 * restart keeps what the user changed during the demo. Returns whether it wrote anything.
 */
export async function seedDemoDatabase(db: AppDb, now: number = Date.now()): Promise<boolean> {
  const existing = await db.select({ count: sql<number>`count(*)` }).from(companies);
  if ((existing[0]?.count ?? 0) > 0) return false;

  const data = demoDataset(now);
  const companyIds = new Map(data.companies.map((company) => [company.name, company.id]));
  const profileVersion = 1;

  await db.insert(profile).values({
    id: 1,
    data: JSON.stringify(data.profile),
    version: profileVersion,
    updatedAt: now,
  });
  await db.insert(profileVersions).values({
    version: profileVersion,
    snapshot: scoringSnapshot(data.profile),
    createdAt: now,
  });

  for (const company of data.companies) {
    await db.insert(companies).values({
      id: company.id,
      name: company.name,
      careersUrl: company.careersUrl,
      ats: company.ats,
      slug: company.slug,
      createdAt: company.createdAt,
    });
  }

  // Open jobs from the list, plus closed ones for applications whose posting is gone.
  const listed = new Set(data.jobs.map((job) => job.id));
  const closedJobs = data.applications
    .filter((application) => !listed.has(application.jobId))
    .map((application) => ({
      id: application.jobId,
      title: application.jobTitle,
      companyName: application.companyName,
      closedAt: application.createdAt,
    }));

  for (const job of data.jobs) {
    const detail = data.jobDetails[job.id] ?? {};
    const companyId = companyIds.get(job.companyName);
    if (!companyId) continue;
    await db.insert(jobs).values({
      id: job.id,
      companyId,
      fingerprint: `demo-${job.id}`,
      title: job.title,
      description: detail.description ?? "",
      url: job.url,
      applyUrl: job.applyUrl,
      language: detail.language ?? null,
      locations: JSON.stringify(job.locations.map((raw) => ({ raw }))),
      workMode: job.workMode,
      remoteScope: detail.remoteScope ?? null,
      employmentType: detail.employmentType ?? "unknown",
      seniority: detail.seniority ?? "unknown",
      salary: detail.salary ? JSON.stringify(detail.salary) : null,
      visaSponsorship: detail.visaSponsorship ?? "unknown",
      postedAt: job.postedAt,
      firstSeenAt: job.firstSeenAt,
      lastSeenAt: now,
      closedAt: null,
    });
    const ats = data.companies.find((company) => company.id === companyId)?.ats ?? "careers";
    await db.insert(jobSources).values({
      source: ats,
      sourceJobId: job.id,
      jobId: job.id,
      companyId,
      url: job.url,
      applyUrl: job.applyUrl,
      lastRunId: "demo-run",
      firstSeenAt: job.firstSeenAt,
      lastSeenAt: now,
      closedAt: null,
    });
    if (job.score !== null) {
      await db.insert(jobScores).values({
        jobId: job.id,
        profileVersion,
        jobHash: "demo",
        profileHash: "demo",
        model: "demo",
        promptVersion: 0,
        explanationLanguage: "en",
        score: job.score,
        explanation: job.explanation ?? "",
        createdAt: now,
      });
    }
    if (!job.isNew || job.dismissed) {
      await db.insert(jobFlags).values({
        jobId: job.id,
        dismissedAt: job.dismissed ? now : null,
        viewedAt: job.isNew ? null : now,
        updatedAt: now,
      });
    }
  }

  for (const job of closedJobs) {
    const companyId = companyIds.get(job.companyName);
    if (!companyId) continue;
    await db.insert(jobs).values({
      id: job.id,
      companyId,
      fingerprint: `demo-${job.id}`,
      title: job.title,
      description: "",
      url: `https://example.com/jobs/${job.id}`,
      applyUrl: `https://example.com/jobs/${job.id}/apply`,
      language: null,
      locations: "[]",
      workMode: "unknown",
      remoteScope: null,
      employmentType: "unknown",
      seniority: "unknown",
      salary: null,
      visaSponsorship: "unknown",
      postedAt: null,
      firstSeenAt: job.closedAt,
      lastSeenAt: job.closedAt,
      closedAt: job.closedAt,
    });
  }

  for (const application of data.applications) {
    await db.insert(applications).values({
      id: application.id,
      jobId: application.jobId,
      status: application.status,
      createdAt: application.createdAt,
      statusChangedAt: application.statusChangedAt,
    });
    for (const event of application.events) {
      await db.insert(applicationEvents).values({
        id: event.id,
        applicationId: application.id,
        status: event.status,
        note: event.note,
        at: event.at,
      });
    }
  }

  // One finished scan, so each company shows its last result.
  const scans = data.companies.filter((company) => company.lastScan !== null);
  const startedAt = Math.min(...scans.map((company) => company.lastScan?.at ?? now)) - 60_000;
  await db.insert(runs).values({
    id: "demo-run",
    kind: "ingest",
    status: "succeeded",
    startedAt,
    finishedAt: startedAt + 120_000,
    message: null,
  });
  let seq = 0;
  for (const company of scans) {
    const scan = company.lastScan;
    if (!scan) continue;
    seq += 1;
    const detail =
      scan.outcome === "scanned"
        ? {
            companyId: company.id,
            companyName: company.name,
            jobCount: scan.jobCount,
            closedCount: scan.closedCount,
          }
        : { companyId: company.id, companyName: company.name, code: scan.code };
    await db.insert(runEvents).values({
      runId: "demo-run",
      seq,
      at: scan.at,
      kind: scan.outcome === "scanned" ? "company-scanned" : "company-failed",
      detail: JSON.stringify(detail),
    });
  }
  await db.insert(runEvents).values({
    runId: "demo-run",
    seq: seq + 1,
    at: startedAt + 120_000,
    kind: "run-finished",
    detail: JSON.stringify({ status: "succeeded" }),
  });
  return true;
}
