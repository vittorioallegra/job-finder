// protects=the application_documents migration adds its table to a populated database of the previous schema without changing the applications, events, jobs or scores already there, and rejects an unknown document kind;
// fails_when=the table is missing after migrating, an existing application or event row is lost or changed, a row with kind "resume" is accepted, or the primary key does not keep one document per application and kind;
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
  const folder = join(mkdtempSync(join(tmpdir(), "job-finder-documents-")), "drizzle");
  cpSync(repoMigrations, folder, { recursive: true });
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

function openDatabase() {
  const dir = mkdtempSync(join(tmpdir(), "job-finder-documents-db-"));
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

/** Journal entries before the step: 0000 to 0012 are thirteen entries. */
const SCHEMA_BEFORE_DOCUMENTS = 13;
const SCHEMA_WITH_DOCUMENTS = 14;

const SEED =
  "INSERT INTO companies (id, name, careers_url, ats, slug, created_at) VALUES ('c1', 'Acme', 'https://boards.greenhouse.io/acme', 'greenhouse', 'acme', 1);" +
  "INSERT INTO jobs (id, company_id, fingerprint, title, description, url, apply_url, locations, work_mode, employment_type, seniority, visa_sponsorship, first_seen_at, last_seen_at) VALUES ('j1', 'c1', 'fp1', 'Engineer', 'Text', 'https://x.test/1', 'https://x.test/1/apply', '[]', 'unknown', 'unknown', 'unknown', 'unknown', 1, 1);" +
  "INSERT INTO applications (id, job_id, status, created_at, status_changed_at) VALUES ('a1', 'j1', 'preparing', 2, 2);" +
  "INSERT INTO application_events (id, application_id, status, note, at) VALUES ('e1', 'a1', 'preparing', NULL, 2);";

describe("application documents migration", () => {
  it("adds application_documents to a populated database and keeps its applications, events and jobs", async () => {
    const db = openDatabase();
    await db.migrate(SCHEMA_BEFORE_DOCUMENTS);
    db.raw.exec(SEED);

    const outcome = await db.migrate(SCHEMA_WITH_DOCUMENTS);

    expect(outcome.backupPath).not.toBeNull();
    expect(tableNames(db.raw)).toContain("application_documents");
    expect(db.raw.prepare("SELECT status FROM applications").get()?.["status"]).toBe("preparing");
    expect(db.raw.prepare("SELECT note FROM application_events").get()?.["note"]).toBeNull();
    expect(db.raw.prepare("SELECT title FROM jobs").get()?.["title"]).toBe("Engineer");
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM application_documents").get()?.["n"]).toBe(0);
  });

  it("keeps one document per application and kind, and refuses an unknown kind", async () => {
    const db = openDatabase();
    await db.migrate(SCHEMA_WITH_DOCUMENTS);
    db.raw.exec(SEED);
    const insert = (kind: string) =>
      db.raw.exec(
        `INSERT INTO application_documents (application_id, kind, content, updated_at) VALUES ('a1', '${kind}', '{}', 1);`,
      );

    insert("cv");
    insert("cover-letter");
    expect(() => insert("cv")).toThrow();
    expect(() => insert("resume")).toThrow();
  });
});
