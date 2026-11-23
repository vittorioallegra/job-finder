// protects=a profile saves only validated data, starts a new scoring version only when a ranking field changes, and reports an invalid stored row instead of guessing;
// fails_when=an invalid profile is stored, a contact or application-default edit bumps the version, a skill change writes no version, or an invalid stored row is read back as a valid profile;
// no_claim=concurrent saves from two windows and migrations of real user databases are not covered; the repository assumes one writer.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { emptyProfile, type Profile } from "@job-finder/core/profile";
import { openAppDatabase, type AppDatabase } from "../db/database";
import { createProfileRepository } from "./repository";

const repoMigrations = resolve(__dirname, "../../../drizzle");
const opened: Array<{ database: AppDatabase; raw: DatabaseSync }> = [];

/** Opens the repository on a fresh database, plus a second raw connection to inspect the rows. */
async function openRepository() {
  const dir = mkdtempSync(join(tmpdir(), "job-finder-profile-repo-"));
  const file = join(dir, "job-finder.sqlite");
  const database = await openAppDatabase({
    file,
    migrationsFolder: repoMigrations,
    backupDirectory: join(dir, "backups"),
  });
  const raw = new DatabaseSync(file);
  opened.push({ database, raw });
  return { repository: createProfileRepository(database.db), raw };
}

function withSkill(profile: Profile, name: string): Profile {
  return { ...profile, skills: [...profile.skills, { name, level: "", aliases: [] }] };
}

function versionCount(raw: DatabaseSync): number {
  return Number(raw.prepare("SELECT count(*) AS count FROM profile_versions").get()?.["count"]);
}

afterEach(() => {
  for (const { database, raw } of opened.splice(0)) {
    raw.close();
    database.close();
  }
});

describe("profile repository", () => {
  it("returns null before onboarding and stores the first profile as version 1", async () => {
    const { repository, raw } = await openRepository();
    expect(await repository.get()).toBeNull();

    const saved = await repository.save(emptyProfile(), 1_000);

    expect(saved).toEqual({ profile: emptyProfile(), version: 1, updatedAt: 1_000 });
    expect(versionCount(raw)).toBe(1);
  });

  it("writes no new version when only contact details or application defaults change", async () => {
    const { repository, raw } = await openRepository();
    const first = await repository.save(withSkill(emptyProfile(), "TypeScript"), 1);

    const second = await repository.save(
      {
        ...first.profile,
        contact: { ...first.profile.contact, phone: "+39 000" },
        applicationDefaults: { ...first.profile.applicationDefaults, noticePeriod: "1 month" },
      },
      2,
    );

    expect(second.version).toBe(1);
    expect(second.profile.contact.phone).toBe("+39 000");
    expect(versionCount(raw)).toBe(1);
  });

  it("starts version 2 when a skill changes", async () => {
    const { repository, raw } = await openRepository();
    const first = await repository.save(emptyProfile(), 1);

    const second = await repository.save(withSkill(first.profile, "Go"), 2);

    expect(second.version).toBe(2);
    expect(versionCount(raw)).toBe(2);
    expect((await repository.get())?.version).toBe(2);
  });

  it("refuses an invalid profile before it reaches the database", async () => {
    const { repository, raw } = await openRepository();
    const invalid = { ...emptyProfile(), links: [{ label: "x", url: "javascript:void(0)" }] };

    await expect(repository.save(invalid as Profile)).rejects.toThrow();

    expect(await repository.get()).toBeNull();
    expect(versionCount(raw)).toBe(0);
  });

  it("reports a stored row that no longer validates, and a save replaces it as a new version", async () => {
    const { repository, raw } = await openRepository();
    await repository.save(emptyProfile(), 1);
    raw.exec(`UPDATE profile SET data = '{"headline": 3}' WHERE id = 1`);

    await expect(repository.get()).rejects.toThrow("does not match the profile schema");

    const repaired = await repository.save(withSkill(emptyProfile(), "Rust"), 5);
    expect(repaired.version).toBe(2);
    expect((await repository.get())?.profile.skills[0]?.name).toBe("Rust");
  });
});
