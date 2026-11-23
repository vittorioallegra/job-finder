import { mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/sqlite-proxy/migrator";
import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";

export interface MigrationOptions {
  /** Folder with drizzle-kit output: `meta/_journal.json` and the SQL files. */
  migrationsFolder: string;
  /** Folder that receives a `VACUUM INTO` copy before any migration runs on a populated database. */
  backupDirectory: string;
  /** File name of the database; used as the prefix of backup files. */
  databaseFile: string;
  now?: () => Date;
}

export interface MigrationOutcome {
  /** Number of migrations not yet recorded before this run. */
  pending: number;
  /** Path of the pre-migration backup, or null when nothing was backed up. */
  backupPath: string | null;
}

const MIGRATIONS_TABLE = "__drizzle_migrations";

function tableExists(raw: DatabaseSync, name: string): boolean {
  const row = raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return row !== undefined;
}

function hasUserTables(raw: DatabaseSync): boolean {
  const row = raw
    .prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .get();
  return Number(row?.["count"] ?? 0) > 0;
}

function appliedHashes(raw: DatabaseSync): Set<string> {
  if (!tableExists(raw, MIGRATIONS_TABLE)) {
    return new Set();
  }
  const rows = raw.prepare(`SELECT hash FROM "${MIGRATIONS_TABLE}"`).all();
  return new Set(rows.map((row) => String(row["hash"])));
}

/** Copies the database with `VACUUM INTO` so a failed migration can be rolled back by hand. */
function backupDatabase(raw: DatabaseSync, options: MigrationOptions): string {
  mkdirSync(options.backupDirectory, { recursive: true });
  const stamp = (options.now ?? (() => new Date()))().toISOString().replace(/[:.]/g, "-");
  const name = basename(options.databaseFile, ".sqlite");
  const backupPath = join(options.backupDirectory, `${name}-${stamp}-pre-migration.sqlite`);
  raw.prepare("VACUUM INTO ?").run(backupPath);
  return backupPath;
}

/** Runs all queries of one migration batch in a single transaction; rolls back on failure. */
function runInTransaction(raw: DatabaseSync, queries: string[]): void {
  raw.exec("BEGIN");
  try {
    for (const query of queries) {
      raw.exec(query);
    }
    raw.exec("COMMIT");
  } catch (error) {
    raw.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Applies pending drizzle-kit migrations. Before running anything on a database that already
 * holds tables, it writes a backup with `VACUUM INTO`; the migrations then run atomically.
 */
export async function migrateDatabase(
  raw: DatabaseSync,
  db: SqliteRemoteDatabase,
  options: MigrationOptions,
): Promise<MigrationOutcome> {
  const migrations = readMigrationFiles({ migrationsFolder: options.migrationsFolder });
  const applied = appliedHashes(raw);
  const pending = migrations.filter((migration) => !applied.has(migration.hash)).length;

  let backupPath: string | null = null;
  if (pending > 0 && hasUserTables(raw)) {
    backupPath = backupDatabase(raw, options);
  }

  await migrate(db, async (queries) => runInTransaction(raw, queries), {
    migrationsFolder: options.migrationsFolder,
  });
  return { pending, backupPath };
}
