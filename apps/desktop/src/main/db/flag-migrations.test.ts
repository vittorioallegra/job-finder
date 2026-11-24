// protects=the job flag migration adds its table to a populated database of the previous schema without changing existing rows, keeps a flag per job that exists, and keeps one flag row per job;
// fails_when=a table is missing after migrating, an existing job, company, profile or score is lost or changed, a flag points at a job that does not exist, or a second flag row for one job is accepted;
// no_claim=the migrations are not checked against a database written by an earlier app release, only against one built here from the earlier migration files;
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { drizzleOverSqlite } from "./sqlite-proxy";
import { migrateDatabase } from "./migrate";

const repoMigrations = resolve(__dirname, "../../../drizzle");

/** Copies the repo migrations and keeps only the first `count` journal entries. */
function migrationsUpTo(count: number): string {
  const folder = join(mkdtempSync(join(tmpdir(), "job-finder-flags-")), "drizzle");
  cpSync(repoMigrations, folder, { recursive: true });
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

function openDatabase() {
  const dir = mkdtempSync(join(tmpdir(), "job-finder-flags-db-"));
  const raw = new DatabaseSync(join(dir, "job-finder.sqlite"));
  raw.exec("PRAGMA foreign_keys = ON;");
  const options = (folder: string) => ({
    migrationsFolder: folder,
    backupDirectory: join(dir, "backups"),
    databaseFile: "job-finder.sqlite",
  });
  return {
    raw,
    migrate: (target: number) =>
      migrateDatabase(raw, drizzleOverSqlite(raw), options(migrationsUpTo(target))),
  };
}

function tableNames(raw: DatabaseSync): string[] {
  return raw
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => String(row["name"]));
}

const SCHEMA_BEFORE_JOB_FLAGS = 10;
const SCHEMA_WITH_JOB_FLAGS = 11;

const SEED_JOB =
  "INSERT INTO companies (id, name, careers_url, ats, slug, created_at) VALUES ('c1', 'Acme', 'https://boards.greenhouse.io/acme', 'greenhouse', 'acme', 1);" +
  "INSERT INTO jobs (id, company_id, fingerprint, title, description, url, apply_url, locations, work_mode, employment_type, seniority, visa_sponsorship, first_seen_at, last_seen_at) VALUES ('j1', 'c1', 'fp1', 'Engineer', 'Text', 'https://x.test/1', 'https://x.test/1/apply', '[]', 'unknown', 'unknown', 'unknown', 'unknown', 1, 1);";

describe("job flag migration", () => {
  it("adds job_flags to a populated database, keeps its rows, and allows one flag row per existing job only", async () => {
    const db = openDatabase();
    await db.migrate(SCHEMA_BEFORE_JOB_FLAGS);
    db.raw.exec(
      SEED_JOB +
        'INSERT INTO profile (id, data, version, updated_at) VALUES (1, \'{"headline":"Engineer"}\', 1, 5);' +
        "INSERT INTO job_scores (job_id, profile_version, job_hash, profile_hash, model, prompt_version, score, explanation, created_at) VALUES ('j1', 1, 'jh', 'ph', 'local-test', 2, 80, 'Strong match.', 7);",
    );

    const outcome = await db.migrate(SCHEMA_WITH_JOB_FLAGS);

    expect(outcome.backupPath).not.toBeNull();
    expect(tableNames(db.raw)).toContain("job_flags");
    expect(db.raw.prepare("SELECT name FROM companies").get()?.["name"]).toBe("Acme");
    expect(db.raw.prepare("SELECT title FROM jobs").get()?.["title"]).toBe("Engineer");
    expect(db.raw.prepare("SELECT data FROM profile WHERE id = 1").get()?.["data"]).toBe(
      '{"headline":"Engineer"}',
    );
    expect(db.raw.prepare("SELECT score FROM job_scores").get()?.["score"]).toBe(80);
    expect(() =>
      db.raw.exec("INSERT INTO job_flags (job_id, dismissed_at, updated_at) VALUES ('j1', 5, 5);"),
    ).not.toThrow();
    expect(() =>
      db.raw.exec("INSERT INTO job_flags (job_id, viewed_at, updated_at) VALUES ('j1', 6, 6);"),
    ).toThrow(/UNIQUE|PRIMARY KEY/);
    expect(() =>
      db.raw.exec(
        "INSERT INTO job_flags (job_id, viewed_at, updated_at) VALUES ('missing', 6, 6);",
      ),
    ).toThrow(/FOREIGN KEY/);
  });
});
