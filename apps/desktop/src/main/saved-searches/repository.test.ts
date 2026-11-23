// protects=saved searches are created with a validated filter, replaced by id, listed oldest first, deleted, and a replace of an unknown id is refused;
// fails_when=a filter outside its schema is stored, a replace creates a new search, a deleted search is still listed, or the list is not in creation order;
// no_claim=the screen that applies a saved search and the scheduler that will run them are not covered here;
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openAppDatabase, type AppDatabase } from "../db/database";
import { createSavedSearchRepository, type SavedSearchRepository } from "./repository";

const repoMigrations = resolve(__dirname, "../../../drizzle");

describe("saved search repository", () => {
  let database: AppDatabase;
  let repository: SavedSearchRepository;

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), "job-finder-saved-"));
    database = await openAppDatabase({
      file: join(dir, "job-finder.sqlite"),
      migrationsFolder: repoMigrations,
      backupDirectory: join(dir, "backups"),
    });
    repository = createSavedSearchRepository(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("creates a search with its filter, lists it, and replaces it by id", async () => {
    const created = await repository.save(
      { name: "Backend Milan", filter: { keywords: ["backend"], countryCode: "IT" } },
      100,
      () => "s1",
    );
    expect(created).toMatchObject({
      id: "s1",
      name: "Backend Milan",
      filter: { keywords: ["backend"], countryCode: "IT", postedWithin: "any" },
      updatedAt: 100,
    });

    const replaced = await repository.save(
      { id: "s1", name: "Backend Remote", filter: { workModes: ["remote"] } },
      200,
    );
    expect(replaced).toMatchObject({
      id: "s1",
      name: "Backend Remote",
      filter: { workModes: ["remote"], countryCode: null },
      updatedAt: 200,
    });
    expect(await repository.list()).toEqual([replaced]);
  });

  it("refuses to replace a search that does not exist, and refuses an invalid filter", async () => {
    expect(
      await repository.save({ id: "missing", name: "Nope", filter: {} }, 1, () => "x"),
    ).toBeNull();
    expect(await repository.list()).toEqual([]);
    await expect(
      repository.save({ name: "Bad", filter: { workModes: ["flying"] } } as never, 1, () => "y"),
    ).rejects.toThrow();
  });

  it("lists searches oldest first and removes a deleted one", async () => {
    await repository.save({ name: "Second", filter: {} }, 300, () => "b");
    await repository.save({ name: "First", filter: {} }, 100, () => "a");
    expect((await repository.list()).map((search) => search.name)).toEqual(["First", "Second"]);

    await repository.delete("a");
    expect((await repository.list()).map((search) => search.name)).toEqual(["Second"]);
  });
});
