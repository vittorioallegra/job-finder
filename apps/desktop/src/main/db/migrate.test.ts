// protects=pending drizzle migrations apply once, a populated database is copied with VACUUM INTO before new migrations run, and a failing migration leaves no partial schema;
// fails_when=an applied migration runs again, a populated database is migrated without a backup, the backup lacks the rows, or a failing batch leaves tables behind;
// no_claim=backup retention, disk-space failures and the packaged resources path are not covered here.
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { drizzleOverSqlite } from "./sqlite-proxy";
import { migrateDatabase } from "./migrate";

const repoMigrations = resolve(__dirname, "../../../drizzle");

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "job-finder-migrate-"));
}

function tableNames(raw: DatabaseSync): string[] {
  return raw
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => String(row["name"]));
}

/** Copies the real migrations and appends one synthetic migration with the given SQL. */
function migrationsWith(sql: string): string {
  const folder = join(tempDir(), "drizzle");
  cpSync(repoMigrations, folder, { recursive: true });
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{
      idx: number;
      version: string;
      when: number;
      tag: string;
      breakpoints: boolean;
    }>;
  };
  const last = journal.entries[journal.entries.length - 1];
  if (!last) {
    throw new Error("repo migrations are empty");
  }
  journal.entries.push({
    idx: last.idx + 1,
    version: last.version,
    when: last.when + 1_000,
    tag: "0001_probe",
    breakpoints: true,
  });
  writeFileSync(journalPath, JSON.stringify(journal));
  writeFileSync(join(folder, "0001_probe.sql"), sql);
  return folder;
}

describe("drizzle migrator with pre-migration backup", () => {
  it("applies the initial migration once and skips it afterwards without a backup", async () => {
    const dir = tempDir();
    const raw = new DatabaseSync(join(dir, "job-finder.sqlite"));
    const options = {
      migrationsFolder: repoMigrations,
      backupDirectory: join(dir, "backups"),
      databaseFile: "job-finder.sqlite",
    };
    const first = await migrateDatabase(raw, drizzleOverSqlite(raw), options);
    expect(first.pending).toBeGreaterThan(0);
    expect(first.backupPath).toBeNull();
    expect(tableNames(raw)).toEqual(expect.arrayContaining(["runs", "settings"]));

    const second = await migrateDatabase(raw, drizzleOverSqlite(raw), options);
    expect(second).toEqual({ pending: 0, backupPath: null });
    raw.close();
  });

  it("copies a populated database before a new migration runs and keeps its rows in the backup", async () => {
    const dir = tempDir();
    const file = join(dir, "job-finder.sqlite");
    const raw = new DatabaseSync(file);
    await migrateDatabase(raw, drizzleOverSqlite(raw), {
      migrationsFolder: repoMigrations,
      backupDirectory: join(dir, "backups"),
      databaseFile: "job-finder.sqlite",
    });
    raw.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('theme', 'dark', 1)").run();

    const outcome = await migrateDatabase(raw, drizzleOverSqlite(raw), {
      migrationsFolder: migrationsWith("CREATE TABLE probe (id TEXT PRIMARY KEY NOT NULL);"),
      backupDirectory: join(dir, "backups"),
      databaseFile: "job-finder.sqlite",
    });
    expect(outcome.pending).toBe(1);
    expect(outcome.backupPath).not.toBeNull();
    expect(tableNames(raw)).toContain("probe");

    const backup = new DatabaseSync(outcome.backupPath as string);
    expect(backup.prepare("SELECT value FROM settings WHERE key = 'theme'").get()).toEqual({
      value: "dark",
    });
    expect(tableNames(backup)).not.toContain("probe");
    backup.close();
    raw.close();
  });

  it("rolls back a failing migration and does not record it as applied", async () => {
    const dir = tempDir();
    const raw = new DatabaseSync(join(dir, "job-finder.sqlite"));
    const options = {
      backupDirectory: join(dir, "backups"),
      databaseFile: "job-finder.sqlite",
    };
    await migrateDatabase(raw, drizzleOverSqlite(raw), {
      ...options,
      migrationsFolder: repoMigrations,
    });

    const broken = migrationsWith(
      "CREATE TABLE probe (id TEXT);--> statement-breakpoint\nINSERT INTO missing_table VALUES (1);",
    );
    await expect(
      migrateDatabase(raw, drizzleOverSqlite(raw), { ...options, migrationsFolder: broken }),
    ).rejects.toThrow();
    expect(tableNames(raw)).not.toContain("probe");
    const recorded = raw.prepare("SELECT count(*) AS count FROM __drizzle_migrations").get();
    expect(recorded).toEqual({ count: 1 });
    raw.close();
  });
});
