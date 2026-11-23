// protects=the job detail lists every source of a job with its open or closed state, a flag change keeps the other flag, dismissing hides nothing it should not, viewing ends the new badge, and an unknown job is reported as missing;
// fails_when=a source is missing from the detail, a closed source reads as open, a dismiss clears the viewed mark or the reverse, a flag on an unknown job is stored or throws, or an unknown job returns a detail;
// no_claim=the screen that shows the detail and the run that closes sources are not covered here; the ingestion tests cover closing;
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { companies, jobSources, jobs } from "@job-finder/core";
import { openAppDatabase, type AppDatabase } from "../db/database";
import { createIngestRepository, type IngestRepository } from "./repository";

const repoMigrations = resolve(__dirname, "../../../drizzle");
const NOW = Date.UTC(2026, 10, 23);

describe("job detail and flags", () => {
  let database: AppDatabase;
  let repository: IngestRepository;

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), "job-finder-detail-"));
    database = await openAppDatabase({
      file: join(dir, "job-finder.sqlite"),
      migrationsFolder: repoMigrations,
      backupDirectory: join(dir, "backups"),
    });
    await database.db.insert(companies).values({
      id: "c1",
      name: "Acme",
      careersUrl: "https://boards.greenhouse.io/acme",
      ats: "greenhouse",
      slug: "acme",
      createdAt: 1,
    });
    await database.db.insert(jobs).values({
      id: "j1",
      companyId: "c1",
      fingerprint: "fp1",
      title: "Backend Engineer",
      description: "Build APIs.",
      url: "https://x.test/1",
      applyUrl: "https://x.test/1/apply",
      language: "en",
      locations: JSON.stringify([{ raw: "Milan, Italy", city: "Milan", countryCode: "IT" }]),
      workMode: "hybrid",
      employmentType: "full_time",
      seniority: "senior",
      salary: JSON.stringify({ min: 60000, max: 70000, currency: "EUR", period: "year" }),
      visaSponsorship: "yes",
      firstSeenAt: NOW - 1000,
      lastSeenAt: NOW - 1000,
      closedAt: null,
    });
    await database.db.insert(jobSources).values([
      {
        source: "greenhouse",
        sourceJobId: "gh-1",
        jobId: "j1",
        companyId: "c1",
        url: "https://x.test/1",
        applyUrl: "https://x.test/1/apply",
        lastRunId: "run-1",
        firstSeenAt: NOW - 1000,
        lastSeenAt: NOW - 500,
        closedAt: null,
      },
      {
        source: "lever",
        sourceJobId: "lv-1",
        jobId: "j1",
        companyId: "c1",
        url: "https://jobs.lever.co/acme/1",
        applyUrl: "https://jobs.lever.co/acme/1/apply",
        lastRunId: "run-0",
        firstSeenAt: NOW - 1000,
        lastSeenAt: NOW - 900,
        closedAt: NOW - 800,
      },
    ]);
    repository = createIngestRepository(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("returns the job with every source, the open one and the closed one marked", async () => {
    const detail = await repository.jobDetail("j1", NOW);

    expect(detail).toMatchObject({
      id: "j1",
      title: "Backend Engineer",
      companyName: "Acme",
      description: "Build APIs.",
      salary: { min: 60000, max: 70000, currency: "EUR", period: "year" },
      isNew: true,
      dismissed: false,
    });
    expect(detail?.sources.map((source) => [source.source, source.closed])).toEqual([
      ["greenhouse", false],
      ["lever", true],
    ]);
  });

  it("reports an unknown job as missing", async () => {
    expect(await repository.jobDetail("missing", NOW)).toBeNull();
    expect(await repository.setJobFlag({ jobId: "missing", viewed: true }, NOW)).toBe(false);
  });

  it("keeps the other flag when one flag changes, so a dismissed job stays dismissed after it is viewed", async () => {
    expect(await repository.setJobFlag({ jobId: "j1", dismissed: true }, NOW)).toBe(true);
    expect(await repository.setJobFlag({ jobId: "j1", viewed: true }, NOW + 1)).toBe(true);

    const detail = await repository.jobDetail("j1", NOW + 2);
    expect(detail).toMatchObject({ dismissed: true, isNew: false });

    await repository.setJobFlag({ jobId: "j1", dismissed: false }, NOW + 3);
    expect(await repository.jobDetail("j1", NOW + 4)).toMatchObject({
      dismissed: false,
      isNew: false,
    });
  });
});
