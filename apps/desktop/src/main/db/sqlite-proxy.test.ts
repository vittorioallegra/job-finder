// protects=node:sqlite rows reach drizzle's sqlite-proxy as positional arrays, and bind values SQLite accepts;
// fails_when=rows come back keyed by column name where drizzle expects positions, a boolean or undefined bind throws, or a drizzle select maps columns to the wrong fields;
// no_claim=the migrations themselves and the engine's use of the adapter are not covered here.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { settings } from "@job-finder/core";
import { drizzleOverSqlite, runStatement } from "./sqlite-proxy";

function memoryDatabase(): DatabaseSync {
  const raw = new DatabaseSync(":memory:");
  raw.exec("CREATE TABLE sample (a INTEGER, b TEXT); INSERT INTO sample VALUES (1, 'x');");
  return raw;
}

describe("sqlite-proxy adapter", () => {
  it("returns positional rows for all and values, and a single positional row for get", () => {
    const raw = memoryDatabase();
    expect(runStatement(raw, "SELECT a, b FROM sample", [], "all")).toEqual({ rows: [[1, "x"]] });
    expect(runStatement(raw, "SELECT a, b FROM sample", [], "values")).toEqual({
      rows: [[1, "x"]],
    });
    expect(runStatement(raw, "SELECT a, b FROM sample", [], "get")).toEqual({ rows: [1, "x"] });
    expect(runStatement(raw, "SELECT a, b FROM sample WHERE a = ?", [99], "get")).toEqual({
      rows: undefined,
    });
  });

  it("binds booleans as 0 and 1 and undefined as NULL", () => {
    const raw = memoryDatabase();
    runStatement(raw, "INSERT INTO sample (a, b) VALUES (?, ?)", [true, undefined], "run");
    expect(
      runStatement(raw, "SELECT a, b FROM sample WHERE a = 1 AND b IS NULL", [], "all"),
    ).toEqual({ rows: [[1, null]] });
    runStatement(raw, "INSERT INTO sample (a, b) VALUES (?, ?)", [false, "y"], "run");
    expect(runStatement(raw, "SELECT a FROM sample WHERE b = 'y'", [], "all")).toEqual({
      rows: [[0]],
    });
  });

  it("maps drizzle selects and inserts through the proxy to the schema's field names", async () => {
    const raw = new DatabaseSync(":memory:");
    raw.exec(
      "CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL);",
    );
    const db = drizzleOverSqlite(raw);
    await db.insert(settings).values({ key: "theme", value: "dark", updatedAt: 42 });
    const rows = await db.select().from(settings);
    expect(rows).toEqual([{ key: "theme", value: "dark", updatedAt: 42 }]);
    raw.close();
  });
});
