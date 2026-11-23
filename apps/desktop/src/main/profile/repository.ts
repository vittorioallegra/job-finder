import { eq } from "drizzle-orm";
import { profile as profileTable, profileVersions } from "@job-finder/core";
import { ProfileSchema, scoringSnapshot, type Profile } from "@job-finder/core/profile";
import type { ProfileRecord } from "@job-finder/bridge";
import type { AppDb } from "../db/operations";

export interface ProfileRepository {
  /** The saved profile, or null before onboarding. Throws when the stored row no longer validates. */
  get(): Promise<ProfileRecord | null>;
  /** Validates and stores the profile. A new scoring version is written only when scoring fields change. */
  save(input: Profile, now?: number): Promise<ProfileRecord>;
}

/** The app has one user, so the profile lives in one row with a fixed id. */
const PROFILE_ROW_ID = 1;

export function createProfileRepository(db: AppDb): ProfileRepository {
  async function readRow() {
    const rows = await db
      .select()
      .from(profileTable)
      .where(eq(profileTable.id, PROFILE_ROW_ID))
      .limit(1);
    return rows[0];
  }

  function parseStored(data: string): Profile | null {
    let value: unknown;
    try {
      value = JSON.parse(data);
    } catch {
      return null;
    }
    const parsed = ProfileSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }

  return {
    async get() {
      const row = await readRow();
      if (!row) {
        return null;
      }
      const stored = parseStored(row.data);
      if (stored === null) {
        throw new Error("The stored profile does not match the profile schema");
      }
      return { profile: stored, version: row.version, updatedAt: row.updatedAt };
    },

    async save(input, now = Date.now()) {
      const next = ProfileSchema.parse(input);
      const row = await readRow();
      const previous = row ? parseStored(row.data) : null;
      const scoringChanged =
        previous === null || scoringSnapshot(previous) !== scoringSnapshot(next);
      const version = row && !scoringChanged ? row.version : (row?.version ?? 0) + 1;

      if (scoringChanged) {
        const snapshot = scoringSnapshot(next);
        await db
          .insert(profileVersions)
          .values({ version, snapshot, createdAt: now })
          .onConflictDoUpdate({
            target: profileVersions.version,
            set: { snapshot, createdAt: now },
          });
      }

      const data = JSON.stringify(next);
      await db
        .insert(profileTable)
        .values({ id: PROFILE_ROW_ID, data, version, updatedAt: now })
        .onConflictDoUpdate({
          target: profileTable.id,
          set: { data, version, updatedAt: now },
        });
      return { profile: next, version, updatedAt: now };
    },
  };
}
