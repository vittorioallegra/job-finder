import { desc, eq } from "drizzle-orm";
import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { runs, settings } from "@job-finder/core";
import type { DbCall, DbResult } from "../../engine/protocol";

export type AppDb = SqliteRemoteDatabase;

async function executeCall(db: AppDb, call: DbCall, now: number): Promise<unknown> {
  switch (call.name) {
    case "settings.get": {
      const rows = await db
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, call.key))
        .limit(1);
      return rows[0]?.value ?? null;
    }
    case "settings.set":
      await db
        .insert(settings)
        .values({ key: call.key, value: call.value, updatedAt: now })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: call.value, updatedAt: now },
        });
      return null;
    case "runs.start":
      await db.insert(runs).values({
        id: call.id,
        kind: call.kind,
        status: "running",
        startedAt: call.startedAt,
      });
      return null;
    case "runs.finish":
      await db
        .update(runs)
        .set({ status: call.status, finishedAt: call.finishedAt })
        .where(eq(runs.id, call.id));
      return null;
    case "runs.list":
      return db.select().from(runs).orderBy(desc(runs.startedAt)).limit(call.limit);
  }
}

/**
 * Executes a batch in order. A failing call yields an error result and the batch continues,
 * so one bad write does not hide the results of the reads after it.
 */
export async function executeDbCalls(
  db: AppDb,
  calls: DbCall[],
  now = Date.now(),
): Promise<DbResult[]> {
  const results: DbResult[] = [];
  for (const call of calls) {
    try {
      results.push({ ok: true, value: await executeCall(db, call, now) });
    } catch (error) {
      results.push({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

/** Marks runs still `running` as `interrupted`; called when an engine crashed or the app restarted. */
export async function reconcileInterruptedRuns(db: AppDb, now = Date.now()): Promise<number> {
  const stale = await db.select({ id: runs.id }).from(runs).where(eq(runs.status, "running"));
  if (stale.length === 0) {
    return 0;
  }
  await db
    .update(runs)
    .set({ status: "interrupted", finishedAt: now })
    .where(eq(runs.status, "running"));
  return stale.length;
}
