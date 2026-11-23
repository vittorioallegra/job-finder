// protects=each ingestion migration adds its table to a populated database of the previous schema without changing existing rows, and the tables keep their keys and foreign keys;
// fails_when=a new table is missing after migrating, an existing settings, runs, companies, jobs or job_sources row is lost or changed, a duplicate careers URL or a duplicate (source, source_job_id) is accepted, or a job points at a company that does not exist;
// no_claim=the migrations are not checked against a database written by an earlier app release, only against databases built here from the earlier migration files.
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
  const folder = join(mkdtempSync(join(tmpdir(), "job-finder-ingest-")), "drizzle");
  cpSync(repoMigrations, folder, { recursive: true });
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

function openAt(count: number) {
  const dir = mkdtempSync(join(tmpdir(), "job-finder-ingest-db-"));
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
    initial: count,
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

function count(raw: DatabaseSync, table: string): number {
  return Number(raw.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.["n"]);
}

const COMPANY_SQL =
  "INSERT INTO companies (id, name, careers_url, ats, slug, created_at) VALUES ('c1', 'Acme', 'https://boards.greenhouse.io/acme', 'greenhouse', 'acme', 1);";
const JOB_SQL =
  "INSERT INTO jobs (id, company_id, fingerprint, title, description, url, apply_url, locations, work_mode, employment_type, seniority, visa_sponsorship, first_seen_at, last_seen_at) VALUES ('j1', 'c1', 'fp1', 'Engineer', 'Text', 'https://x.test/1', 'https://x.test/1/apply', '[]', 'unknown', 'unknown', 'unknown', 'unknown', 1, 1);";
const SOURCE_SQL =
  "INSERT INTO job_sources (source, source_job_id, job_id, company_id, url, apply_url, last_run_id, first_seen_at, last_seen_at) VALUES ('greenhouse', '42', 'j1', 'c1', 'https://x.test/1', 'https://x.test/1/apply', 'r1', 1, 1);";

describe("ingestion migrations", () => {
  it("adds companies to a populated database and keeps its settings, runs and profile rows", async () => {
    const db = openAt(3);
    await db.migrate(db.initial);
    db.raw.exec(
      "INSERT INTO settings (key, value, updated_at) VALUES ('settings.ui', '{\"language\":\"it\"}', 1);" +
        "INSERT INTO runs (id, kind, status, started_at) VALUES ('r1', 'probe', 'succeeded', 1);" +
        'INSERT INTO profile (id, data, version, updated_at) VALUES (1, \'{"headline":"Engineer"}\', 1, 5);',
    );

    const outcome = await db.migrate(4);

    expect(outcome.backupPath).not.toBeNull();
    expect(tableNames(db.raw)).toContain("companies");
    expect(db.raw.prepare("SELECT value FROM settings").get()?.["value"]).toBe('{"language":"it"}');
    expect(count(db.raw, "runs")).toBe(1);
    expect(db.raw.prepare("SELECT data FROM profile WHERE id = 1").get()?.["data"]).toBe(
      '{"headline":"Engineer"}',
    );
    db.raw.exec(COMPANY_SQL);
    expect(() =>
      db.raw.exec(
        "INSERT INTO companies (id, name, careers_url, created_at) VALUES ('c2', 'Other', 'https://boards.greenhouse.io/acme', 2);",
      ),
    ).toThrow();
    db.raw.close();
  });

  it("adds jobs with its fingerprint index to a populated database that holds companies", async () => {
    const db = openAt(4);
    await db.migrate(db.initial);
    db.raw.exec(COMPANY_SQL);

    const outcome = await db.migrate(5);

    expect(outcome.backupPath).not.toBeNull();
    expect(tableNames(db.raw)).toContain("jobs");
    expect(count(db.raw, "companies")).toBe(1);
    db.raw.exec(JOB_SQL);
    expect(db.raw.prepare("SELECT title FROM jobs WHERE id = 'j1'").get()?.["title"]).toBe(
      "Engineer",
    );
    const index = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'jobs'")
      .all()
      .map((row) => String(row["name"]));
    expect(index).toContain("jobs_fingerprint_idx");
    expect(() =>
      db.raw.exec(
        "INSERT INTO jobs (id, company_id, fingerprint, title, description, url, apply_url, locations, work_mode, employment_type, seniority, visa_sponsorship, first_seen_at, last_seen_at) VALUES ('j2', 'missing', 'fp2', 'T', 'D', 'u', 'a', '[]', 'unknown', 'unknown', 'unknown', 'unknown', 1, 1);",
      ),
    ).toThrow();
    db.raw.close();
  });

  it("adds job_sources to a populated database and keeps the job it points at", async () => {
    const db = openAt(5);
    await db.migrate(db.initial);
    db.raw.exec(COMPANY_SQL + JOB_SQL);

    const outcome = await db.migrate(6);

    expect(outcome.backupPath).not.toBeNull();
    expect(tableNames(db.raw)).toContain("job_sources");
    expect(count(db.raw, "jobs")).toBe(1);
    db.raw.exec(SOURCE_SQL);
    expect(() => db.raw.exec(SOURCE_SQL)).toThrow();
    db.raw.close();
  });

  it("adds run_events to a populated database and keeps its runs", async () => {
    const db = openAt(6);
    await db.migrate(db.initial);
    db.raw.exec(
      "INSERT INTO runs (id, kind, status, started_at) VALUES ('r1', 'ingest', 'running', 1);",
    );

    const outcome = await db.migrate(7);

    expect(outcome.backupPath).not.toBeNull();
    expect(tableNames(db.raw)).toContain("run_events");
    expect(db.raw.prepare("SELECT status FROM runs WHERE id = 'r1'").get()?.["status"]).toBe(
      "running",
    );
    db.raw.exec(
      "INSERT INTO run_events (run_id, seq, at, kind, detail) VALUES ('r1', 1, 2, 'run-started', '{}');",
    );
    expect(() =>
      db.raw.exec(
        "INSERT INTO run_events (run_id, seq, at, kind, detail) VALUES ('r1', 1, 3, 'run-started', '{}');",
      ),
    ).toThrow();
    db.raw.close();
  });
});
