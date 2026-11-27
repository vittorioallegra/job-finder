import { and, desc, isNull, sql } from "drizzle-orm";
import { jobs } from "@job-finder/core";
import { jobFilterCondition } from "@job-finder/core/filters/sql";
import type { JobFilter } from "@job-finder/core/filters";
import type { AppDb } from "./operations";

/**
 * The text (title and description) of the newest open jobs that pass the filter: what the skills
 * check reads to see what the postings for the profile's roles ask for.
 */
export async function marketJobTexts(
  db: AppDb,
  filter: JobFilter,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ title: jobs.title, description: jobs.description })
    .from(jobs)
    .where(and(isNull(jobs.closedAt), jobFilterCondition(filter)))
    .orderBy(sql`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt}) desc`, desc(jobs.id))
    .limit(limit);
  return rows.map((row) => `${row.title}\n${row.description}`);
}
