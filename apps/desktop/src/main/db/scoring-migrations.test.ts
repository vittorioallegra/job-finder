// protects=the scoring migration adds job_scores to a populated database of the previous schema without changing existing rows, and the table keeps one score per job and profile version, a score within 0 to 100, and a job that exists;
// fails_when=job_scores is missing after migrating, an existing company, job, profile or settings row is lost or changed, a second score for the same job and profile version is accepted, a score outside 0 to 100 is accepted, or a score points at a job that does not exist;
// no_claim=the migration is not checked against a database written by an earlier app release, only against one built here from the earlier migration files;
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
  const folder = join(mkdtempSync(join(tmpdir(), "job-finder-scoring-")), "drizzle");
  cpSync(repoMigrations, folder, { recursive: true });
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

function openDatabase() {
  const dir = mkdtempSync(join(tmpdir(), "job-finder-scoring-db-"));
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

const PREVIOUS_SCHEMA_ENTRIES = 7;
const NEW_SCHEMA_ENTRIES = 8;

const SCORE_SQL = (jobId: string, version: number, score: number) =>
  `INSERT INTO job_scores (job_id, profile_version, job_hash, profile_hash, model, prompt_version, score, explanation, created_at) VALUES ('${jobId}', ${version}, 'jh', 'ph', 'local-test', 1, ${score}, 'Fit.', 1);`;

describe("scoring migration", () => {
  it("adds job_scores to a populated database and keeps its companies, jobs, profile and settings rows", async () => {
    const db = openDatabase();
    await db.migrate(PREVIOUS_SCHEMA_ENTRIES);
    db.raw.exec(
      "INSERT INTO settings (key, value, updated_at) VALUES ('settings.ui', '{\"language\":\"it\"}', 1);" +
        "INSERT INTO companies (id, name, careers_url, ats, slug, created_at) VALUES ('c1', 'Acme', 'https://boards.greenhouse.io/acme', 'greenhouse', 'acme', 1);" +
        "INSERT INTO jobs (id, company_id, fingerprint, title, description, url, apply_url, locations, work_mode, employment_type, seniority, visa_sponsorship, first_seen_at, last_seen_at) VALUES ('j1', 'c1', 'fp1', 'Engineer', 'Text', 'https://x.test/1', 'https://x.test/1/apply', '[]', 'unknown', 'unknown', 'unknown', 'unknown', 1, 1);" +
        'INSERT INTO profile (id, data, version, updated_at) VALUES (1, \'{"headline":"Engineer"}\', 1, 5);',
    );

    const outcome = await db.migrate(NEW_SCHEMA_ENTRIES);

    expect(outcome.backupPath).not.toBeNull();
    expect(tableNames(db.raw)).toContain("job_scores");
    expect(db.raw.prepare("SELECT value FROM settings").get()?.["value"]).toBe('{"language":"it"}');
    expect(db.raw.prepare("SELECT name FROM companies").get()?.["name"]).toBe("Acme");
    expect(db.raw.prepare("SELECT title FROM jobs").get()?.["title"]).toBe("Engineer");
    expect(db.raw.prepare("SELECT data FROM profile WHERE id = 1").get()?.["data"]).toBe(
      '{"headline":"Engineer"}',
    );
  });

  it("keeps one score per job and profile version, rejects a score outside 0 to 100, and rejects a job that does not exist", async () => {
    const db = openDatabase();
    await db.migrate(NEW_SCHEMA_ENTRIES);
    db.raw.exec(
      "INSERT INTO companies (id, name, careers_url, ats, slug, created_at) VALUES ('c1', 'Acme', 'https://boards.greenhouse.io/acme', 'greenhouse', 'acme', 1);" +
        "INSERT INTO jobs (id, company_id, fingerprint, title, description, url, apply_url, locations, work_mode, employment_type, seniority, visa_sponsorship, first_seen_at, last_seen_at) VALUES ('j1', 'c1', 'fp1', 'Engineer', 'Text', 'https://x.test/1', 'https://x.test/1/apply', '[]', 'unknown', 'unknown', 'unknown', 'unknown', 1, 1);" +
        SCORE_SQL("j1", 1, 80),
    );

    expect(() => db.raw.exec(SCORE_SQL("j1", 1, 60))).toThrow(/UNIQUE|PRIMARY KEY/);
    expect(() => db.raw.exec(SCORE_SQL("j1", 2, 101))).toThrow(/CHECK/);
    expect(() => db.raw.exec(SCORE_SQL("missing", 1, 50))).toThrow(/FOREIGN KEY/);
    expect(() => db.raw.exec(SCORE_SQL("j1", 2, 70))).not.toThrow();
  });
});
