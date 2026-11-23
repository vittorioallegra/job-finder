import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { drizzleOverSqlite } from "./sqlite-proxy";
import { migrateDatabase, type MigrationOutcome } from "./migrate";

export interface OpenDatabaseOptions {
  file: string;
  migrationsFolder: string;
  backupDirectory: string;
}

export interface AppDatabase {
  readonly db: SqliteRemoteDatabase;
  readonly migration: MigrationOutcome;
  close(): void;
}

/** Opens the SQLite file in WAL mode, applies pending migrations and returns the query builder. */
export async function openAppDatabase(options: OpenDatabaseOptions): Promise<AppDatabase> {
  const raw = new DatabaseSync(options.file);
  try {
    raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    const db = drizzleOverSqlite(raw);
    const migration = await migrateDatabase(raw, db, {
      migrationsFolder: options.migrationsFolder,
      backupDirectory: options.backupDirectory,
      databaseFile: options.file,
    });
    return { db, migration, close: () => raw.close() };
  } catch (error) {
    raw.close();
    throw error;
  }
}

/**
 * Picks the migrations folder: the repo copy in development (`appRoot` is the desktop package
 * root, two levels above the bundled `out/main`), the copy shipped as `extraResources` when packaged.
 */
export function resolveMigrationsFolder(options: {
  isPackaged: boolean;
  resourcesPath: string;
  appRoot: string;
}): string {
  return options.isPackaged
    ? join(options.resourcesPath, "drizzle")
    : join(options.appRoot, "drizzle");
}
