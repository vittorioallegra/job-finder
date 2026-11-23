// protects=the applications and application_events migrations add their tables to a populated database of the previous schema without changing existing rows, and keep each application's job and each event's application;
// fails_when=a table is missing after migrating, an existing job, company, flag or score row is lost or changed, or an application row is lost when the events table is added;
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
  const folder = join(mkdtempSync(join(tmpdir(), "job-finder-applications-")), "drizzle");
  cpSync(repoMigrations, folder, { recursive: true });
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

function openDatabase() {
  const dir = mkdtempSync(join(tmpdir(), "job-finder-applications-db-"));
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

/** Journal entries before each step: 0000 to 0010 are eleven entries. */
const SCHEMA_BEFORE_APPLICATIONS = 11;
const SCHEMA_WITH_APPLICATIONS = 12;
const SCHEMA_WITH_APPLICATION_EVENTS = 13;

const SEED =
  "INSERT INTO companies (id, name, careers_url, ats, slug, created_at) VALUES ('c1', 'Acme', 'https://boards.greenhouse.io/acme', 'greenhouse', 'acme', 1);" +
  "INSERT INTO jobs (id, company_id, fingerprint, title, description, url, apply_url, locations, work_mode, employment_type, seniority, visa_sponsorship, first_seen_at, last_seen_at) VALUES ('j1', 'c1', 'fp1', 'Engineer', 'Text', 'https://x.test/1', 'https://x.test/1/apply', '[]', 'unknown', 'unknown', 'unknown', 'unknown', 1, 1);" +
  "INSERT INTO job_flags (job_id, dismissed_at, viewed_at, updated_at) VALUES ('j1', NULL, 3, 3);" +
  "INSERT INTO job_scores (job_id, profile_version, job_hash, profile_hash, model, prompt_version, score, explanation, created_at) VALUES ('j1', 1, 'jh', 'ph', 'local-test', 2, 80, 'Strong match.', 7);";

describe("applications migration", () => {
  it("adds applications to a populated database and keeps its companies, jobs, flags and scores", async () => {
    const db = openDatabase();
    await db.migrate(SCHEMA_BEFORE_APPLICATIONS);
    db.raw.exec(SEED);

    const outcome = await db.migrate(SCHEMA_WITH_APPLICATIONS);

    expect(outcome.backupPath).not.toBeNull();
    expect(tableNames(db.raw)).toContain("applications");
    expect(db.raw.prepare("SELECT name FROM companies").get()?.["name"]).toBe("Acme");
    expect(db.raw.prepare("SELECT title FROM jobs").get()?.["title"]).toBe("Engineer");
    expect(db.raw.prepare("SELECT viewed_at FROM job_flags").get()?.["viewed_at"]).toBe(3);
    expect(db.raw.prepare("SELECT score FROM job_scores").get()?.["score"]).toBe(80);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM applications").get()?.["n"]).toBe(0);
  });
});

describe("application events migration", () => {
  it("adds application_events to a populated database and keeps its applications and jobs", async () => {
    const db = openDatabase();
    await db.migrate(SCHEMA_WITH_APPLICATIONS);
    db.raw.exec(
      SEED +
        "INSERT INTO applications (id, job_id, status, created_at, status_changed_at) VALUES ('a1', 'j1', 'applied', 5, 9);",
    );

    const outcome = await db.migrate(SCHEMA_WITH_APPLICATION_EVENTS);

    expect(outcome.backupPath).not.toBeNull();
    expect(tableNames(db.raw)).toContain("application_events");
    expect(
      db.raw.prepare("SELECT status FROM applications WHERE id = 'a1'").get()?.["status"],
    ).toBe("applied");
    expect(db.raw.prepare("SELECT title FROM jobs").get()?.["title"]).toBe("Engineer");
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM application_events").get()?.["n"]).toBe(0);
  });
});
