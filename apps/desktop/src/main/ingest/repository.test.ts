// protects=a company is stored only with a board the adapters can read, one board is stored once, the job list shows only open jobs, and the latest run comes back with its log in order;
// fails_when=a careers URL with no supported board is stored, the same board is stored twice, a closed job is listed, or the run log is returned out of order or without its kinds;
// no_claim=the careers URL is checked by its shape only, without a request, so a board that does not exist is still stored; the database schema is covered by the migration tests.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { companies, runs } from "@job-finder/core";
import type { IngestEvent } from "@job-finder/core/ingest/events";
import { openAppDatabase, type AppDatabase } from "../db/database";
import { appendRunEvent } from "../db/ingest-operations";
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
  it("stores a company with its detected board and refuses an unsupported or repeated one", async () => {
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
      },
    });

    expect(
      await repository.addCompany({ name: "Other", careersUrl: "https://example.com/careers" }),
    ).toEqual({ ok: false, code: "unsupported-careers-url" });
    expect(
      await repository.addCompany({
        name: "Acme again",
        careersUrl: "https://job-boards.greenhouse.io/acme",
      }),
    ).toEqual({ ok: false, code: "duplicate-company" });
    expect(await repository.listCompanies()).toHaveLength(1);
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
});
