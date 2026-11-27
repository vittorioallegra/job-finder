import { eq } from "drizzle-orm";
import { settings } from "@job-finder/core";
import type { AiProfileReview } from "@job-finder/core/profile/review-types";
import type { AppDb } from "../db/operations";

/** The written review of the profile as it was last made: kept until the profile or the language changes. */
export interface StoredProfileReview {
  /** `profileHash` of the ranking fields and the roles it was made for. */
  profileHash: string;
  language: string;
  promptVersion: number;
  createdAt: number;
  review: AiProfileReview;
}

export interface ProfileReviewStore {
  get(): Promise<StoredProfileReview | null>;
  set(value: StoredProfileReview): Promise<void>;
}

const KEY = "profile.review";

/** The review lives in the shared key-value table, one JSON row. */
export function createProfileReviewStore(db: AppDb): ProfileReviewStore {
  return {
    async get() {
      const [row] = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
      if (!row) return null;
      try {
        const parsed = JSON.parse(row.value) as StoredProfileReview;
        return typeof parsed.profileHash === "string" && Array.isArray(parsed.review?.suggestions)
          ? parsed
          : null;
      } catch {
        return null;
      }
    },
    async set(value) {
      const json = JSON.stringify(value);
      await db
        .insert(settings)
        .values({ key: KEY, value: json, updatedAt: value.createdAt })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: json, updatedAt: value.createdAt },
        });
    },
  };
}
