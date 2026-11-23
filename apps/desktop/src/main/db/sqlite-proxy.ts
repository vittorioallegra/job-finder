import type { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import type { RemoteCallback, SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";

export type SqlMethod = "run" | "all" | "values" | "get";

/** node:sqlite returns objects keyed by column name; drizzle's proxy expects positional arrays. */
export function toPositionalRow(row: Record<string, unknown>): unknown[] {
  return Object.values(row);
}

/** node:sqlite rejects booleans and undefined as bind values; drizzle may pass both. */
function toBindValue(value: unknown): unknown {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  return value === undefined ? null : value;
}

/** Runs one statement synchronously and shapes the result the way drizzle's proxy expects. */
export function runStatement(
  raw: DatabaseSync,
  sql: string,
  params: unknown[],
  method: SqlMethod,
): { rows: unknown[] | undefined } {
  const statement = raw.prepare(sql);
  const bindings = params.map(toBindValue);
  if (method === "run") {
    statement.run(...(bindings as never[]));
    return { rows: [] };
  }
  if (method === "get") {
    const row = statement.get(...(bindings as never[]));
    return { rows: row === undefined ? undefined : toPositionalRow(row) };
  }
  const rows = statement.all(...(bindings as never[]));
  return { rows: rows.map(toPositionalRow) };
}

/** Adapter that lets drizzle's sqlite-proxy driver talk to a synchronous node:sqlite connection. */
export function createSqliteProxyCallback(raw: DatabaseSync): RemoteCallback {
  // drizzle types `rows` as any[]; for `get` the single row (or undefined) is the value itself.
  return async (sql, params, method) =>
    runStatement(raw, sql, params, method) as { rows: unknown[] };
}

/** Drizzle query builder over a node:sqlite connection. All access goes through this adapter. */
export function drizzleOverSqlite(raw: DatabaseSync): SqliteRemoteDatabase {
  return drizzle(createSqliteProxyCallback(raw));
}
