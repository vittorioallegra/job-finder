// protects=the status migration folds interviewing into applied, offer into accepted and withdrawn into rejected on applications and their events, and leaves the other statuses and every other column alone;
// fails_when=a stored status outside the new set remains after migrating, a to-send or applied row changes, or an event keeps the old name;
// no_claim=a database written by an earlier app release is not used, only one built here from the earlier migration files.
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { drizzleOverSqlite } from "./sqlite-proxy";
import { migrateDatabase } from "./migrate";

const repoMigrations = resolve(__dirname, "../../../drizzle");

function migrationsUpTo(count: number): string {
  const folder = join(mkdtempSync(join(tmpdir(), "job-finder-status-")), "drizzle");
  cpSync(repoMigrations, folder, { recursive: true });
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{ tag: string }>;
  };
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

describe("application status migration", () => {
  it("folds the dropped statuses into the kept ones, on applications and on events", async () => {
    const dir = mkdtempSync(join(tmpdir(), "job-finder-status-db-"));
    const raw = new DatabaseSync(join(dir, "job-finder.sqlite"));
    raw.exec("PRAGMA foreign_keys = ON;");
    const journal = JSON.parse(
      readFileSync(join(repoMigrations, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ tag: string }> };
    const index = journal.entries.findIndex((entry) =>
      entry.tag.includes("simplify-application-statuses"),
    );
    expect(index).toBeGreaterThan(0);
    const options = (folder: string) => ({
      migrationsFolder: folder,
      backupDirectory: join(dir, "backups"),
      databaseFile: "job-finder.sqlite",
    });
    await migrateDatabase(raw, drizzleOverSqlite(raw), options(migrationsUpTo(index)));

    raw.exec(
      "INSERT INTO companies (id, name, careers_url, ats, slug, created_at) VALUES ('c1', 'Acme', 'https://x.test', null, null, 1);",
    );
    const statuses = ["preparing", "applied", "interviewing", "offer", "withdrawn", "rejected"];
    statuses.forEach((status, n) => {
      raw.exec(
        `INSERT INTO jobs (id, company_id, fingerprint, title, description, url, apply_url, locations, work_mode, employment_type, seniority, visa_sponsorship, first_seen_at, last_seen_at) VALUES ('j${n}', 'c1', 'fp${n}', 'T', 'D', 'https://x.test/${n}', 'https://x.test/${n}', '[]', 'unknown', 'unknown', 'unknown', 'unknown', 1, 1);` +
          `INSERT INTO applications (id, job_id, status, created_at, status_changed_at) VALUES ('a${n}', 'j${n}', '${status}', 1, 1);` +
          `INSERT INTO application_events (id, application_id, status, note, at) VALUES ('e${n}', 'a${n}', '${status}', null, 1);`,
      );
    });

    await migrateDatabase(raw, drizzleOverSqlite(raw), options(repoMigrations));

    const read = (table: string) =>
      raw
        .prepare(`SELECT status FROM ${table} ORDER BY id`)
        .all()
        .map((row) => String(row["status"]));
    const expected = ["preparing", "applied", "applied", "accepted", "rejected", "rejected"];
    expect(read("applications")).toEqual(expected);
    expect(read("application_events")).toEqual(expected);
  });
});
