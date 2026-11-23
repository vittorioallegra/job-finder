// protects=a posting seen on two sources is stored as one job with two source rows, a job closes only when every one of its sources is closed by a complete scan, and a job seen again reopens;
// fails_when=the same opening from two sources is stored twice, a job closes while one of its sources is still open, a missing posting of a complete scan stays open, or a reseen posting stays closed;
// no_claim=the scan's board reads and the run log are not exercised here; the ingestion migrations and the engine controller tests cover them.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { companies, jobSources, jobs } from "@job-finder/core";
import { lookupRequest, planBatch } from "@job-finder/core/ingest";
import type { NormalizedJob } from "@job-finder/core/normalize";
import { openAppDatabase, type AppDatabase } from "./database";
import { closeMissingSources, lookupExisting, persistPlan } from "./ingest-operations";

const repoMigrations = resolve(__dirname, "../../../drizzle");

async function openDatabase(): Promise<AppDatabase> {
  const dir = mkdtempSync(join(tmpdir(), "job-finder-ingest-ops-"));
  return openAppDatabase({
    file: join(dir, "job-finder.sqlite"),
    migrationsFolder: repoMigrations,
    backupDirectory: join(dir, "backups"),
  });
}

function posting(source: string, sourceJobId: string): NormalizedJob {
  return {
    source,
    sourceJobId,
    url: `https://example.test/${source}/${sourceJobId}`,
    applyUrl: `https://example.test/${source}/${sourceJobId}/apply`,
    companyName: "Acme",
    title: "Backend Engineer",
    description: "Build things.",
    locations: [{ raw: "Milan, Italy", city: "Milan", countryCode: "IT" }],
    workMode: "unknown",
    employmentType: "unknown",
    seniority: "unknown",
    visaSponsorship: "unknown",
  };
}

/** One complete scan of a company board: plan the postings, persist them, then close what is missing. */
async function completeScan(
  database: AppDatabase,
  runId: string,
  postings: NormalizedJob[],
  at: number,
): Promise<number> {
  const existing = await lookupExisting(database.db, lookupRequest(postings));
  const plan = planBatch({
    companyId: "co-1",
    runId,
    seenAt: at,
    jobs: postings,
    existing,
    newId: () => crypto.randomUUID(),
  });
  await persistPlan(database.db, plan);
  return closeMissingSources(database.db, "co-1", runId, at);
}

async function jobRows(database: AppDatabase) {
  return database.db.select({ id: jobs.id, closedAt: jobs.closedAt }).from(jobs);
}

async function sourceRows(database: AppDatabase) {
  return database.db
    .select({ source: jobSources.source, closedAt: jobSources.closedAt })
    .from(jobSources);
}

describe("ingestion database operations", () => {
  it("stores the new title, description and salary when a posting is seen again", async () => {
    const database = await openDatabase();
    await database.db.insert(companies).values({
      id: "co-1",
      name: "Acme",
      careersUrl: "https://boards.greenhouse.io/acme",
      ats: "greenhouse",
      slug: "acme",
      createdAt: 1,
    });
    // protects=a reseen posting updates the stored job content; fails_when=a changed title, description or salary stays as first stored, so the content hash never changes and scores are never invalidated; no_claim=the scoring rules;
    await completeScan(database, "run-1", [posting("greenhouse", "1")], 100);
    const changed: NormalizedJob = {
      ...posting("greenhouse", "1"),
      title: "Senior Backend Engineer",
      description: "Lead the platform team.",
      salary: { min: 90000, max: 110000, currency: "EUR", period: "year" },
    };

    await completeScan(database, "run-2", [changed], 200);

    const rows = await database.db
      .select({ title: jobs.title, description: jobs.description, salary: jobs.salary })
      .from(jobs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "Senior Backend Engineer",
      description: "Lead the platform team.",
    });
    expect(JSON.parse(rows[0]?.salary ?? "null")).toMatchObject({ min: 90000, max: 110000 });
  });

  it("stores one opening from two sources once and closes it only when both sources are gone", async () => {
    const database = await openDatabase();
    await database.db.insert(companies).values({
      id: "co-1",
      name: "Acme",
      careersUrl: "https://boards.greenhouse.io/acme",
      ats: "greenhouse",
      slug: "acme",
      createdAt: 1,
    });
    const both = [posting("greenhouse", "1"), posting("lever", "abc")];

    expect(await completeScan(database, "run-1", both, 100)).toBe(0);
    expect(await jobRows(database)).toHaveLength(1);
    expect(await sourceRows(database)).toHaveLength(2);

    expect(await completeScan(database, "run-2", [posting("greenhouse", "1")], 200)).toBe(1);
    expect(await jobRows(database)).toEqual([expect.objectContaining({ closedAt: null })]);
    expect(await sourceRows(database)).toContainEqual(
      expect.objectContaining({ source: "lever", closedAt: 200 }),
    );

    expect(await completeScan(database, "run-3", [], 300)).toBe(1);
    expect(await jobRows(database)).toEqual([expect.objectContaining({ closedAt: 300 })]);

    expect(await completeScan(database, "run-4", [posting("greenhouse", "1")], 400)).toBe(0);
    expect(await jobRows(database)).toEqual([expect.objectContaining({ closedAt: null })]);
    expect(await sourceRows(database)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "greenhouse", closedAt: null }),
        expect.objectContaining({ source: "lever", closedAt: 200 }),
      ]),
    );
    database.close();
  });
});
