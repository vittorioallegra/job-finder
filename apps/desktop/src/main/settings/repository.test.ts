// protects=settings sections round-trip through the database, a patch changes only the sections it names, and malformed stored rows fall back to defaults;
// fails_when=a user who had an AI set up loses it after an update, a patch resets other sections, an invalid patch is written, or a corrupt row makes the whole settings object unreadable;
// no_claim=concurrent writers and transaction atomicity across sections are not covered here.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { settings } from "@job-finder/core";
import { DEFAULT_APP_SETTINGS } from "@job-finder/bridge";
import { openAppDatabase, type AppDatabase } from "../db/database";
import { createSettingsRepository } from "./repository";

describe("settings repository", () => {
  let database: AppDatabase;

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), "job-finder-settings-"));
    database = await openAppDatabase({
      file: join(dir, "job-finder.sqlite"),
      migrationsFolder: resolve(__dirname, "../../../drizzle"),
      backupDirectory: join(dir, "backups"),
    });
  });

  afterEach(() => database.close());

  it("returns the defaults on a fresh database", async () => {
    const repository = createSettingsRepository(database.db);
    expect(await repository.get()).toEqual(DEFAULT_APP_SETTINGS);
  });

  it("changes only the sections named in a patch", async () => {
    const repository = createSettingsRepository(database.db);
    const next = await repository.update({ scheduler: { intervalHours: 6 } });
    expect(next.scheduler.intervalHours).toBe(6);
    expect(next.ai).toEqual(DEFAULT_APP_SETTINGS.ai);
    expect(await repository.get()).toEqual(next);
  });

  it("keeps the other keys of a section that a patch touches", async () => {
    const repository = createSettingsRepository(database.db);
    await repository.update({ ai: { model: "model-a", contextSize: 4096 } });
    const next = await repository.update({ ai: { model: "model-b" } });
    expect(next.ai).toEqual({ ...DEFAULT_APP_SETTINGS.ai, model: "model-b", contextSize: 4096 });
  });

  it("rejects an invalid patch and leaves the stored settings unchanged", async () => {
    const repository = createSettingsRepository(database.db);
    await expect(repository.update({ scheduler: { intervalHours: 0 } })).rejects.toThrow();
    expect(await repository.get()).toEqual(DEFAULT_APP_SETTINGS);
  });

  it("falls back to the defaults for one section whose stored row is malformed", async () => {
    await database.db.insert(settings).values({
      key: "settings.ui",
      value: "{not json",
      updatedAt: 1,
    });
    await database.db.insert(settings).values({
      key: "settings.notifications",
      value: JSON.stringify({ enabled: false }),
      updatedAt: 1,
    });
    const repository = createSettingsRepository(database.db);
    const current = await repository.get();
    expect(current.ui).toEqual(DEFAULT_APP_SETTINGS.ui);
    expect(current.notifications.enabled).toBe(false);
  });

  it("reads settings saved before the AI could be switched off: on when a model was chosen, off otherwise", async () => {
    const legacy = { provider: "anthropic", model: "claude-x", baseUrl: "", contextSize: 8192 };
    await database.db
      .insert(settings)
      .values({ key: "settings.ai", value: JSON.stringify(legacy), updatedAt: 1 });
    const repository = createSettingsRepository(database.db);
    expect((await repository.get()).ai).toMatchObject({ enabled: true, model: "claude-x" });

    await database.db.update(settings).set({ value: JSON.stringify({ ...legacy, model: "" }) });
    expect((await repository.get()).ai.enabled).toBe(false);
    // A fresh install has no AI until the user picks one.
    expect(DEFAULT_APP_SETTINGS.ai.enabled).toBe(false);
  });
});
