import { and, desc, eq, inArray } from "drizzle-orm";
import { runs } from "@job-finder/core";
import { INGEST_RUN_KIND } from "@job-finder/core/ingest/events";
import type { AppDb } from "../db/operations";

/** Ingestion runs that ended on their own (not cancelled, not interrupted by a crash). */
const FINISHED_RUN_STATUSES = ["succeeded", "failed"] as const;

/** When the newest ingestion run that succeeded or failed ended; null when none has. */
export async function lastFinishedIngestRunAt(db: AppDb): Promise<number | null> {
  const [row] = await db
    .select({ finishedAt: runs.finishedAt })
    .from(runs)
    .where(and(eq(runs.kind, INGEST_RUN_KIND), inArray(runs.status, [...FINISHED_RUN_STATUSES])))
    .orderBy(desc(runs.finishedAt))
    .limit(1);
  return row?.finishedAt ?? null;
}
