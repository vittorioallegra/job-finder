// protects=the app database opens with the migrations applied and the migrations folder resolves to the repo copy in development and the bundled copy when packaged;
// fails_when=a freshly opened database lacks the settings or runs tables, or the packaged build reads migrations from the source tree;
// no_claim=WAL checkpointing behaviour and file locking between two processes are not covered here.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runs } from "@job-finder/core";
import { openAppDatabase, resolveMigrationsFolder } from "./database";

describe("app database", () => {
  it("opens a new file with every migration applied", async () => {
    const dir = mkdtempSync(join(tmpdir(), "job-finder-db-"));
    const database = await openAppDatabase({
      file: join(dir, "job-finder.sqlite"),
      migrationsFolder: resolve(__dirname, "../../../drizzle"),
      backupDirectory: join(dir, "backups"),
    });
    const rows = await database.db.select().from(runs);
    expect(rows).toEqual([]);
    expect(database.migration.backupPath).toBeNull();
    database.close();
  });

  it("resolves migrations from the repo in development and from resources when packaged", () => {
    expect(
      resolveMigrationsFolder({ isPackaged: false, resourcesPath: "/res", appRoot: "/app" }),
    ).toBe(join("/app", "drizzle"));
    expect(
      resolveMigrationsFolder({ isPackaged: true, resourcesPath: "/res", appRoot: "/app" }),
    ).toBe(join("/res", "drizzle"));
  });
});
