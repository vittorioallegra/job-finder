// protects=the migration points a stored Personio posting's apply link at its form page, and leaves other providers and already-correct links alone;
// fails_when=a Personio job keeps the posting page as its apply link, another provider's link changes, or a link is changed twice;
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
  const folder = join(mkdtempSync(join(tmpdir(), "job-finder-personio-")), "drizzle");
  cpSync(repoMigrations, folder, { recursive: true });
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

describe("personio apply url migration", () => {
  it("rewrites the apply link of Personio postings only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "job-finder-personio-db-"));
    const raw = new DatabaseSync(join(dir, "job-finder.sqlite"));
    raw.exec("PRAGMA foreign_keys = ON;");
    const journal = JSON.parse(
      readFileSync(join(repoMigrations, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ tag: string }> };
    const index = journal.entries.findIndex((entry) => entry.tag.includes("personio-apply-url"));
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
    const urls = [
      "https://acme.jobs.personio.de/job/1",
      "https://boards.greenhouse.io/acme/jobs/2",
      "https://acme.jobs.personio.de/job/3/apply",
    ];
    urls.forEach((url, n) => {
      raw.exec(
        `INSERT INTO jobs (id, company_id, fingerprint, title, description, url, apply_url, locations, work_mode, employment_type, seniority, visa_sponsorship, first_seen_at, last_seen_at) VALUES ('j${n}', 'c1', 'fp${n}', 'T', 'D', '${url}', '${url}', '[]', 'unknown', 'unknown', 'unknown', 'unknown', 1, 1);`,
      );
    });

    await migrateDatabase(raw, drizzleOverSqlite(raw), options(repoMigrations));

    const applyUrls = raw
      .prepare("SELECT apply_url FROM jobs ORDER BY id")
      .all()
      .map((row) => String(row["apply_url"]));
    expect(applyUrls).toEqual([
      "https://acme.jobs.personio.de/job/1/apply",
      "https://boards.greenhouse.io/acme/jobs/2",
      "https://acme.jobs.personio.de/job/3/apply",
    ]);
  });
});
