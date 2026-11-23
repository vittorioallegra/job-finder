// protects=the explanation language migration adds explanation_language to a populated job_scores table, marks the existing explanations as English, and stores an Italian explanation beside them;
// fails_when=an existing score row loses its values or gets a language other than en, the column is missing after migrating, or an Italian explanation cannot be stored;
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
  const folder = join(mkdtempSync(join(tmpdir(), "job-finder-language-")), "drizzle");
  cpSync(repoMigrations, folder, { recursive: true });
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

function openDatabase() {
  const dir = mkdtempSync(join(tmpdir(), "job-finder-language-db-"));
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

const PREVIOUS_SCHEMA_ENTRIES = 8;
const NEW_SCHEMA_ENTRIES = 9;

describe("explanation language migration", () => {
  it("marks the scores stored before it as English and keeps their values", async () => {
    const db = openDatabase();
    await db.migrate(PREVIOUS_SCHEMA_ENTRIES);
    db.raw.exec(
      "INSERT INTO companies (id, name, careers_url, ats, slug, created_at) VALUES ('c1', 'Acme', 'https://boards.greenhouse.io/acme', 'greenhouse', 'acme', 1);" +
        "INSERT INTO jobs (id, company_id, fingerprint, title, description, url, apply_url, locations, work_mode, employment_type, seniority, visa_sponsorship, first_seen_at, last_seen_at) VALUES ('j1', 'c1', 'fp1', 'Engineer', 'Text', 'https://x.test/1', 'https://x.test/1/apply', '[]', 'unknown', 'unknown', 'unknown', 'unknown', 1, 1);" +
        "INSERT INTO job_scores (job_id, profile_version, job_hash, profile_hash, model, prompt_version, score, explanation, created_at) VALUES ('j1', 1, 'jh', 'ph', 'local-test', 1, 80, 'Strong match.', 7);",
    );

    await db.migrate(NEW_SCHEMA_ENTRIES);

    const row = db.raw
      .prepare(
        "SELECT score, explanation, explanation_language AS language FROM job_scores WHERE job_id = 'j1'",
      )
      .get();
    expect(row).toEqual({ score: 80, explanation: "Strong match.", language: "en" });
  });

  it("stores an Italian explanation beside an English one for the same job and profile version under its own profile version", async () => {
    const db = openDatabase();
    await db.migrate(NEW_SCHEMA_ENTRIES);
    db.raw.exec(
      "INSERT INTO companies (id, name, careers_url, ats, slug, created_at) VALUES ('c1', 'Acme', 'https://boards.greenhouse.io/acme', 'greenhouse', 'acme', 1);" +
        "INSERT INTO jobs (id, company_id, fingerprint, title, description, url, apply_url, locations, work_mode, employment_type, seniority, visa_sponsorship, first_seen_at, last_seen_at) VALUES ('j1', 'c1', 'fp1', 'Engineer', 'Text', 'https://x.test/1', 'https://x.test/1/apply', '[]', 'unknown', 'unknown', 'unknown', 'unknown', 1, 1);" +
        "INSERT INTO job_scores (job_id, profile_version, job_hash, profile_hash, model, prompt_version, score, explanation, explanation_language, created_at) VALUES ('j1', 1, 'jh', 'ph', 'local-test', 2, 80, 'Strong match.', 'en', 1);",
    );

    expect(() =>
      db.raw.exec(
        "INSERT INTO job_scores (job_id, profile_version, job_hash, profile_hash, model, prompt_version, score, explanation, explanation_language, created_at) VALUES ('j1', 2, 'jh', 'ph', 'local-test', 2, 70, 'Buona corrispondenza.', 'it', 1);",
      ),
    ).not.toThrow();
  });
});
