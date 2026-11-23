// protects=the scheduler's "last run" is the newest ingestion run that ended, however it ended, so a cancelled or crashed scan is not restarted a minute later, a running run never moves the schedule, and a missing history reads as none;
// fails_when=a cancelled or interrupted run is ignored (a cancelled scan restarts at once), a scan of another kind counts, the newest finish is not the one returned, or an empty runs table returns a time;
// no_claim=how runs are written by the engine and reconciled at startup is covered by the database and engine tests, not here.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runs } from "@job-finder/core";
import { openAppDatabase, type AppDatabase } from "../db/database";
import { lastFinishedIngestRunAt } from "./store";

const repoMigrations = resolve(__dirname, "../../../drizzle");

describe("last finished ingestion run", () => {
  let database: AppDatabase;

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), "job-finder-scheduler-"));
    database = await openAppDatabase({
      file: join(dir, "job-finder.sqlite"),
      migrationsFolder: repoMigrations,
      backupDirectory: join(dir, "backups"),
    });
  });

  afterEach(() => {
    database.close();
  });

  async function addRun(id: string, kind: string, status: string, finishedAt: number | null) {
    await database.db.insert(runs).values({
      id,
      kind,
      status: status as "running",
      startedAt: 1,
      finishedAt,
    });
  }

  it("reads no time from an empty history", async () => {
    expect(await lastFinishedIngestRunAt(database.db)).toBeNull();
  });

  it("returns the newest run that ended in any way, and skips running ones and other kinds", async () => {
    await addRun("old", "ingest", "succeeded", 100);
    await addRun("newest-cancelled", "ingest", "cancelled", 900);
    await addRun("newest-interrupted", "ingest", "interrupted", 800);
    await addRun("still-running", "ingest", "running", null);
    await addRun("failed", "ingest", "failed", 300);
    await addRun("other-kind", "export", "succeeded", 950);

    expect(await lastFinishedIngestRunAt(database.db)).toBe(900);
  });
});
