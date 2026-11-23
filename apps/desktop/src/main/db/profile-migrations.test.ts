// protects=the profile migrations add their tables to a populated database without touching existing rows, and a backup is written before they run;
// fails_when=the profile table or profile_versions is missing after migrating, an existing settings, runs or profile row is lost or changed, or a populated database is migrated without a backup;
// no_claim=the migrations are not checked against a real installed user database from an earlier app release, only against a database built here.
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { drizzleOverSqlite } from "./sqlite-proxy";
import { migrateDatabase } from "./migrate";

const repoMigrations = resolve(__dirname, "../../../drizzle");

/** Copies the repo migrations and keeps only the first `count` journal entries, to build an older schema. */
function migrationsUpTo(count: number): string {
  const folder = join(mkdtempSync(join(tmpdir(), "job-finder-profile-")), "drizzle");
  cpSync(repoMigrations, folder, { recursive: true });
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

function tableNames(raw: DatabaseSync): string[] {
  return raw
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => String(row["name"]));
}

function optionsFor(folder: string, directory: string) {
  return {
    migrationsFolder: folder,
    backupDirectory: join(directory, "backups"),
    databaseFile: "job-finder.sqlite",
  };
}

describe("profile migrations", () => {
  it("adds the profile table to a populated v0 database and keeps its settings and runs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "job-finder-profile-db-"));
    const raw = new DatabaseSync(join(dir, "job-finder.sqlite"));
    await migrateDatabase(raw, drizzleOverSqlite(raw), optionsFor(migrationsUpTo(1), dir));
    raw.exec(
      "INSERT INTO settings (key, value, updated_at) VALUES ('settings.ui', '{\"language\":\"it\"}', 1);" +
        "INSERT INTO runs (id, kind, status, started_at) VALUES ('r1', 'probe', 'succeeded', 1);",
    );

    const outcome = await migrateDatabase(
      raw,
      drizzleOverSqlite(raw),
      optionsFor(repoMigrations, dir),
    );

    expect(outcome.backupPath).not.toBeNull();
    expect(tableNames(raw)).toEqual(expect.arrayContaining(["profile", "profile_versions"]));
    const setting = raw.prepare("SELECT value FROM settings WHERE key = 'settings.ui'").get();
    expect(setting?.["value"]).toBe('{"language":"it"}');
    expect(raw.prepare("SELECT count(*) AS n FROM runs").get()?.["n"]).toBe(1);
    raw.close();
  });

  it("adds profile_versions to a database that already holds a profile, keeping the profile row", async () => {
    const dir = mkdtempSync(join(tmpdir(), "job-finder-profile-db-"));
    const raw = new DatabaseSync(join(dir, "job-finder.sqlite"));
    await migrateDatabase(raw, drizzleOverSqlite(raw), optionsFor(migrationsUpTo(2), dir));
    raw.exec(
      'INSERT INTO profile (id, data, version, updated_at) VALUES (1, \'{"headline":"Engineer"}\', 1, 5);',
    );

    const outcome = await migrateDatabase(
      raw,
      drizzleOverSqlite(raw),
      optionsFor(repoMigrations, dir),
    );

    expect(outcome.pending).toBe(1);
    expect(outcome.backupPath).not.toBeNull();
    expect(tableNames(raw)).toContain("profile_versions");
    const row = raw.prepare("SELECT data, version FROM profile WHERE id = 1").get();
    expect(row?.["data"]).toBe('{"headline":"Engineer"}');
    expect(row?.["version"]).toBe(1);
    expect(raw.prepare("SELECT count(*) AS n FROM profile_versions").get()?.["n"]).toBe(0);
    raw.close();
  });
});
