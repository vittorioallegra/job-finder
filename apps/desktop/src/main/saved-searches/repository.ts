import { asc, eq } from "drizzle-orm";
import { savedSearches } from "@job-finder/core";
import { JobFilterSchema } from "@job-finder/core/filters";
import type { SavedSearch, SavedSearchSaveRequest } from "@job-finder/bridge";
import type { AppDb } from "../db/operations";

export interface SavedSearchRepository {
  /** Saved searches, oldest first. A stored filter that no longer validates fails the read. */
  list(): Promise<SavedSearch[]>;
  /** Creates a search, or replaces the one with `request.id`. Resolves null when that id is unknown. */
  save(
    request: SavedSearchSaveRequest,
    now?: number,
    newId?: () => string,
  ): Promise<SavedSearch | null>;
  delete(id: string): Promise<void>;
}

export function createSavedSearchRepository(db: AppDb): SavedSearchRepository {
  return {
    async list() {
      const rows = await db.select().from(savedSearches).orderBy(asc(savedSearches.createdAt));
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        filter: JobFilterSchema.parse(JSON.parse(row.filters)),
        updatedAt: row.updatedAt,
      }));
    },

    async save(request, now = Date.now(), newId = () => crypto.randomUUID()) {
      const filters = JSON.stringify(JobFilterSchema.parse(request.filter));
      if (request.id !== undefined) {
        const [existing] = await db
          .select({ id: savedSearches.id })
          .from(savedSearches)
          .where(eq(savedSearches.id, request.id))
          .limit(1);
        if (!existing) return null;
        await db
          .update(savedSearches)
          .set({ name: request.name, filters, updatedAt: now })
          .where(eq(savedSearches.id, request.id));
        return {
          id: request.id,
          name: request.name,
          filter: JobFilterSchema.parse(JSON.parse(filters)),
          updatedAt: now,
        };
      }
      const id = newId();
      await db.insert(savedSearches).values({
        id,
        name: request.name,
        filters,
        createdAt: now,
        updatedAt: now,
      });
      return {
        id,
        name: request.name,
        filter: JobFilterSchema.parse(JSON.parse(filters)),
        updatedAt: now,
      };
    },

    async delete(id) {
      await db.delete(savedSearches).where(eq(savedSearches.id, id));
    },
  };
}
