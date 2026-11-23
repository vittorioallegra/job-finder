// protects=the desktop demo fills an empty database so the app's own repositories list the sample companies, scored jobs and applications, only in development and in a folder apart from the real data;
// fails_when=a seeded row breaks a constraint or a join, the repositories return different data than the shared demo dataset, a second start writes the data again, or a packaged app honours the switch;
// no_claim=how the screens render the data is not checked here.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { demoDataset } from "@job-finder/bridge/demo";
import { createApplicationRepository } from "../applications/repository";
import { openAppDatabase } from "../db/database";
import { createIngestRepository } from "../ingest/repository";
import { demoDataDirectory, seedDemoDatabase } from "./seed";

async function openEmpty() {
  const dir = mkdtempSync(join(tmpdir(), "job-finder-demo-"));
  return openAppDatabase({
    file: join(dir, "job-finder.sqlite"),
    migrationsFolder: resolve(__dirname, "../../../drizzle"),
    backupDirectory: join(dir, "backups"),
  });
}

describe("desktop demo seed", () => {
  it("writes data the repositories read back like the shared dataset", async () => {
    const now = Date.UTC(2026, 10, 23, 12);
    const expected = demoDataset(now);
    const database = await openEmpty();

    expect(await seedDemoDatabase(database.db, now)).toBe(true);

    const ingest = createIngestRepository(database.db);
    const companies = await ingest.listCompanies();
    expect(companies.map((company) => company.name).sort()).toEqual(
      expected.companies.map((company) => company.name).sort(),
    );
    const kairos = companies.find((company) => company.name === "Kairos");
    expect(kairos?.lastScan).toMatchObject({ outcome: "failed" });

    const jobs = await ingest.listJobs({ filter: {}, sort: "affinity" }, now);
    // The default filter hides dismissed jobs and jobs already applied to.
    const visible = expected.jobs.filter(
      (job) => !job.dismissed && job.applicationStatus !== "applied",
    );
    expect(jobs.map((job) => job.id).sort()).toEqual(visible.map((job) => job.id).sort());
    const top = jobs.find((job) => job.id === "j1");
    expect(top).toMatchObject({ score: 92, isNew: true, applicationStatus: "preparing" });
    expect(jobs.find((job) => job.id === "j8")?.score).toBeNull();

    const tracker = createApplicationRepository(database.db);
    const applications = await tracker.list();
    expect(applications.map((item) => item.id).sort()).toEqual(
      expected.applications.map((item) => item.id).sort(),
    );
    database.close();
  });

  it("leaves a database that already has companies alone", async () => {
    const database = await openEmpty();
    expect(await seedDemoDatabase(database.db)).toBe(true);
    expect(await seedDemoDatabase(database.db)).toBe(false);
    database.close();
  });

  it("uses a folder of its own, only in development and only when asked", () => {
    expect(demoDataDirectory({ JOB_FINDER_DEMO: "1" }, false, "/data/Job Finder")).toBe(
      "/data/Job Finder-demo",
    );
    expect(demoDataDirectory({ JOB_FINDER_DEMO: "1" }, true, "/data/Job Finder")).toBeNull();
    expect(demoDataDirectory({}, false, "/data/Job Finder")).toBeNull();
  });
});
