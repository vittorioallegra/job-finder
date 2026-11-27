// protects=a company is stored with its supported board or as a generic careers page, one board or careers URL is stored once, the job list shows only open jobs ordered by affinity for the current profile version with unscored jobs last, the latest run comes back with its log in order, each company shows its most recent scan, a removed company leaves the sources and the lists, stays saved with who excluded it, is listed apart, and comes back kept;
// fails_when=an excluded directory company is missing from the excluded list or is scanned, a board or careers URL already stored is stored again, a supported careers URL is stored without its board, a closed job is listed, a score of an older profile version orders a job, the run log is returned out of order or without its kinds, or a company shows an older scan than its latest;
// no_claim=the careers URL is checked by its shape only, without a request, so a board that does not exist is still stored; the database schema is covered by the migration tests.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { companies, jobs, jobScores, profile, runs } from "@job-finder/core";
import type { IngestEvent } from "@job-finder/core/ingest/events";
import { openAppDatabase, type AppDatabase } from "../db/database";
import { appendRunEvent, listCompanyRows } from "../db/ingest-operations";
import { createIngestRepository } from "./repository";

const repoMigrations = resolve(__dirname, "../../../drizzle");

async function openDatabase(): Promise<AppDatabase> {
  const dir = mkdtempSync(join(tmpdir(), "job-finder-ingest-repo-"));
  return openAppDatabase({
    file: join(dir, "job-finder.sqlite"),
    migrationsFolder: repoMigrations,
    backupDirectory: join(dir, "backups"),
  });
}

describe("ingest repository", () => {
  it("stores a company with its detected board or its careers page, and refuses a repeated one", async () => {
    const database = await openDatabase();
    const repository = createIngestRepository(database.db);

    const added = await repository.addCompany(
      { name: "Acme", careersUrl: "https://boards.greenhouse.io/acme" },
      10,
      () => "co-1",
    );
    expect(added).toEqual({
      ok: true,
      company: {
        id: "co-1",
        name: "Acme",
        careersUrl: "https://boards.greenhouse.io/acme",
        ats: "greenhouse",
        slug: "acme",
        createdAt: 10,
        country: null,
        lastScan: null,
      },
    });

    expect(
      await repository.addCompany({ name: "Other", careersUrl: "https://example.com/careers" }),
    ).toMatchObject({
      ok: true,
      company: { ats: null, slug: null, careersUrl: "https://example.com/careers" },
    });
    expect(
      await repository.addCompany({
        name: "Acme again",
        careersUrl: "https://job-boards.greenhouse.io/acme",
      }),
    ).toEqual({ ok: false, code: "duplicate-company" });
    expect(await repository.listCompanies()).toHaveLength(2);
    database.close();
  });

  it("removes a company from the sources: no scan, no jobs, not added again unless by hand", async () => {
    const database = await openDatabase();
    const repository = createIngestRepository(database.db);
    await repository.addCompany(
      { name: "Acme", careersUrl: "https://boards.greenhouse.io/acme" },
      1,
      () => "co-1",
    );
    await database.db.insert(jobs).values({
      id: "job-1",
      companyId: "co-1",
      fingerprint: "fp-1",
      title: "Frontend Engineer",
      description: "",
      url: "https://boards.greenhouse.io/acme/jobs/1",
      applyUrl: "https://boards.greenhouse.io/acme/jobs/1",
      locations: "[]",
      workMode: "remote",
      employmentType: "full_time",
      seniority: "mid",
      visaSponsorship: "unknown",
      firstSeenAt: 1,
      lastSeenAt: 1,
    });
    expect(await repository.listJobs()).toHaveLength(1);

    expect(await repository.removeCompany("co-1", 5)).toBe(true);
    expect(await repository.removeCompany("missing")).toBe(false);
    expect(await repository.listCompanies()).toEqual([]);
    expect(await repository.listJobs()).toEqual([]);
    expect(await listCompanyRows(database.db)).toEqual([]);
    // The company search does not bring it back.
    expect(
      await repository.addCompany({
        name: "acme",
        careersUrl: "https://boards.greenhouse.io/acme",
      }),
    ).toEqual({ ok: false, code: "duplicate-company" });

    // Added by hand, it comes back with its jobs.
    expect(
      await repository.addCompany({
        name: "Acme",
        careersUrl: "https://boards.greenhouse.io/acme",
        restore: true,
      }),
    ).toMatchObject({ ok: true, company: { id: "co-1" } });
    expect(await repository.listCompanies()).toHaveLength(1);
    expect(await repository.listJobs()).toHaveLength(1);
    database.close();
  });

  it("shows each company's most recent scan from the run log, or none before its first", async () => {
    const database = await openDatabase();
    const repository = createIngestRepository(database.db);
    await database.db.insert(companies).values([
      {
        id: "co-1",
        name: "Acme",
        careersUrl: "https://boards.greenhouse.io/acme",
        ats: "greenhouse",
        slug: "acme",
        createdAt: 1,
      },
      {
        id: "co-2",
        name: "Globex",
        careersUrl: "https://jobs.lever.co/globex",
        ats: "lever",
        slug: "globex",
        createdAt: 2,
      },
    ]);
    await database.db.insert(runs).values([
      { id: "run-1", kind: "ingest", status: "succeeded", startedAt: 5, finishedAt: 9 },
      { id: "run-2", kind: "ingest", status: "succeeded", startedAt: 20, finishedAt: 29 },
    ]);
    for (const event of [
      {
        runId: "run-1",
        seq: 0,
        at: 6,
        kind: "company-scanned",
        companyId: "co-1",
        companyName: "Acme",
        jobCount: 3,
        closedCount: 0,
      },
      {
        runId: "run-1",
        seq: 1,
        at: 7,
        kind: "company-failed",
        companyId: "co-2",
        companyName: "Globex",
        code: "http-status",
      },
      {
        runId: "run-2",
        seq: 0,
        at: 21,
        kind: "company-failed",
        companyId: "co-1",
        companyName: "Acme",
        code: "timeout",
      },
    ] as IngestEvent[]) {
      await appendRunEvent(database.db, event);
    }

    const listed = await repository.listCompanies();

    expect(listed.find((company) => company.id === "co-1")?.lastScan).toEqual({
      outcome: "failed",
      at: 21,
      code: "timeout",
    });
    expect(listed.find((company) => company.id === "co-2")?.lastScan).toEqual({
      outcome: "failed",
      at: 7,
      code: "http-status",
    });
    database.close();
  });

  it("lists open jobs only, and returns the latest ingestion run with its log in order", async () => {
    const database = await openDatabase();
    const repository = createIngestRepository(database.db);
    await database.db.insert(companies).values({
      id: "co-1",
      name: "Acme",
      careersUrl: "https://boards.greenhouse.io/acme",
      ats: "greenhouse",
      slug: "acme",
      createdAt: 1,
    });

    expect(await repository.latestRun()).toBeNull();
    expect(await repository.listJobs()).toEqual([]);

    await database.db.insert(runs).values({
      id: "run-1",
      kind: "ingest",
      status: "succeeded",
      startedAt: 5,
      finishedAt: 9,
    });
    const events: IngestEvent[] = [
      { runId: "run-1", seq: 0, at: 5, kind: "run-started" },
      {
        runId: "run-1",
        seq: 1,
        at: 6,
        kind: "company-failed",
        companyId: "co-1",
        companyName: "Acme",
        code: "timeout",
      },
      { runId: "run-1", seq: 2, at: 9, kind: "run-finished", status: "succeeded" },
    ];
    for (const event of events) {
      await appendRunEvent(database.db, event);
    }

    const latest = await repository.latestRun();
    expect(latest?.run).toEqual({
      id: "run-1",
      kind: "ingest",
      status: "succeeded",
      startedAt: 5,
      finishedAt: 9,
    });
    expect(latest?.events).toEqual(events);
    database.close();
  });

  it("lists open jobs by affinity for the current profile version, unscored jobs last and newest first", async () => {
    const database = await openDatabase();
    await database.db.insert(companies).values({
      id: "c1",
      name: "Acme",
      careersUrl: "https://x.test/careers",
      ats: null,
      slug: null,
      createdAt: 1,
    });
    await database.db.insert(profile).values({ id: 1, data: "{}", version: 2, updatedAt: 1 });
    const job = (id: string, firstSeenAt: number) => ({
      id,
      companyId: "c1",
      fingerprint: `fp-${id}`,
      title: `Engineer ${id}`,
      description: "Build things.",
      url: `https://x.test/${id}`,
      applyUrl: `https://x.test/${id}/apply`,
      locations: "[]",
      workMode: "unknown",
      employmentType: "unknown",
      seniority: "unknown",
      visaSponsorship: "unknown",
      firstSeenAt,
      lastSeenAt: firstSeenAt,
    });
    await database.db
      .insert(jobs)
      .values([job("low", 1), job("high", 2), job("none", 9), job("stale", 8)]);
    const stored = (jobId: string, profileVersion: number, value: number) => ({
      jobId,
      profileVersion,
      jobHash: "jh",
      profileHash: "ph",
      model: "local-test",
      promptVersion: 1,
      score: value,
      explanation: "Fit.",
      createdAt: 1,
    });
    await database.db
      .insert(jobScores)
      .values([stored("low", 2, 40), stored("high", 2, 90), stored("stale", 1, 99)]);

    const list = await createIngestRepository(database.db).listJobs();

    expect(list.map((item) => item.id)).toEqual(["high", "low", "none", "stale"]);
    expect(list[0]).toMatchObject({ score: 90, explanation: "Fit." });
    expect(list[2]).toMatchObject({ score: null, explanation: null });
    expect(list[3]).toMatchObject({ score: null, explanation: null });
  });

  it("keeps an excluded company saved with who excluded it, lists it apart, and brings it back kept", async () => {
    const database = await openDatabase();
    const repository = createIngestRepository(database.db);
    await repository.addCompany(
      { name: "Acme", careersUrl: "https://boards.greenhouse.io/acme" },
      10,
      () => "co-1",
    );
    await repository.addCompany(
      { name: "Beta", careersUrl: "https://boards.greenhouse.io/beta" },
      11,
      () => "co-2",
    );

    expect(await repository.removeCompany("co-1", 20)).toBe(true);
    expect(await repository.removeCompany("co-2", 21, "auto")).toBe(true);

    expect(await repository.listCompanies()).toEqual([]);
    expect((await repository.listExcluded()).map((c) => [c.id, c.reason])).toEqual([
      ["co-2", "auto"],
      ["co-1", "user"],
    ]);
    expect(await repository.restoreCompany("co-2")).toBe(true);
    expect(await repository.restoreCompany("co-2")).toBe(false);
    expect((await repository.listCompanies()).map((c) => c.id)).toEqual(["co-2"]);
    const [row] = await database.db.select().from(companies).where(eq(companies.id, "co-2"));
    expect(row).toMatchObject({ excludedAt: null, excludedReason: null, origin: "manual" });
    database.close();
  });

  it("lists an excluded directory company among the excluded, and never among the scanned ones", async () => {
    const database = await openDatabase();
    const repository = createIngestRepository(database.db);
    await database.db.insert(companies).values({
      id: "dir-1",
      name: "Accenture",
      careersUrl: "directory:accenture",
      ats: null,
      slug: null,
      createdAt: 1,
      country: "IT",
      origin: "discovery",
    });
    expect(await repository.removeCompany("dir-1", 30)).toBe(true);

    expect(await repository.listCompanies()).toEqual([]);
    expect((await repository.listExcluded()).map((c) => [c.name, c.reason])).toEqual([
      ["Accenture", "user"],
    ]);
    database.close();
  });
});
