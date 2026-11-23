// protects=the scoring database calls read only open jobs with their parsed locations and salary, store one score per job and profile version so a second write replaces the first, read the scores of one profile version only, and list open jobs newest first;
// fails_when=a closed or unknown job is read for scoring, a score of another profile version is returned, a second score for the same job and version is kept beside the first, a salary or location stays as text, or the open jobs are listed oldest first;
// no_claim=the scoring run and the affinity order of the job list are not exercised here; the engine scoring tests and the repository test cover them;
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { companies, jobs } from "@job-finder/core";
import type { StoredScore } from "@job-finder/core/ranking";
import { openAppDatabase, type AppDatabase } from "./database";
import { loadScoringJobs, lookupScores, openJobIds, persistScores } from "./scoring-operations";

const repoMigrations = resolve(__dirname, "../../../drizzle");

async function openDatabase(): Promise<AppDatabase> {
  const dir = mkdtempSync(join(tmpdir(), "job-finder-scoring-ops-"));
  return openAppDatabase({
    file: join(dir, "job-finder.sqlite"),
    migrationsFolder: repoMigrations,
    backupDirectory: join(dir, "backups"),
  });
}

function jobRow(id: string, firstSeenAt: number, closedAt: number | null = null) {
  return {
    id,
    companyId: "c1",
    fingerprint: `fp-${id}`,
    title: `Engineer ${id}`,
    description: "Build things.",
    url: `https://x.test/${id}`,
    applyUrl: `https://x.test/${id}/apply`,
    locations: JSON.stringify([{ raw: "Milan, Italy", city: "Milan", countryCode: "IT" }]),
    workMode: "hybrid",
    employmentType: "full-time",
    seniority: "senior",
    salary: JSON.stringify({ min: 60000, max: 70000, currency: "EUR", period: "year" }),
    visaSponsorship: "unknown",
    firstSeenAt,
    lastSeenAt: firstSeenAt,
    closedAt,
  };
}

function score(jobId: string, profileVersion: number, value: number): StoredScore {
  return {
    jobId,
    profileVersion,
    jobHash: "jh",
    profileHash: "ph",
    model: "local-test",
    promptVersion: 1,
    explanationLanguage: "en",
    score: value,
    explanation: "Fit.",
    createdAt: 1,
  };
}

describe("scoring database calls", () => {
  it("reads only open jobs, with their locations and salary parsed", async () => {
    const database = await openDatabase();
    await database.db.insert(companies).values({
      id: "c1",
      name: "Acme",
      careersUrl: "https://x.test/careers",
      ats: null,
      slug: null,
      createdAt: 1,
    });
    await database.db.insert(jobs).values([jobRow("open", 1), jobRow("closed", 2, 9)]);

    const loaded = await loadScoringJobs(database.db, ["open", "closed", "missing"]);

    expect(loaded.map((job) => job.id)).toEqual(["open"]);
    expect(loaded[0]).toMatchObject({
      companyName: "Acme",
      locations: [{ raw: "Milan, Italy", city: "Milan", countryCode: "IT" }],
      salary: { min: 60000, max: 70000, currency: "EUR", period: "year" },
    });
  });

  it("stores one score per job and profile version, replaces it on a second write, and reads one version only", async () => {
    const database = await openDatabase();
    await database.db.insert(companies).values({
      id: "c1",
      name: "Acme",
      careersUrl: "https://x.test/careers",
      ats: null,
      slug: null,
      createdAt: 1,
    });
    await database.db.insert(jobs).values([jobRow("j1", 1)]);

    await persistScores(database.db, [score("j1", 1, 40)]);
    await persistScores(database.db, [score("j1", 1, 85), score("j1", 2, 30)]);

    expect(await lookupScores(database.db, 1, ["j1"])).toEqual([
      expect.objectContaining({ jobId: "j1", profileVersion: 1, score: 85 }),
    ]);
    expect(await lookupScores(database.db, 2, ["j1"])).toEqual([
      expect.objectContaining({ jobId: "j1", profileVersion: 2, score: 30 }),
    ]);
  });

  it("lists open jobs newest first, leaving out closed ones", async () => {
    const database = await openDatabase();
    await database.db.insert(companies).values({
      id: "c1",
      name: "Acme",
      careersUrl: "https://x.test/careers",
      ats: null,
      slug: null,
      createdAt: 1,
    });
    await database.db
      .insert(jobs)
      .values([jobRow("old", 1), jobRow("new", 5), jobRow("gone", 9, 10)]);

    expect(await openJobIds(database.db, 10)).toEqual(["new", "old"]);
    expect(await openJobIds(database.db, 1)).toEqual(["new"]);
  });
});
