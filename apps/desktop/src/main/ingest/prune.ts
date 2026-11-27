import { and, asc, eq, inArray, isNull, like, notLike, sql } from "drizzle-orm";
import { companies, jobs } from "@job-finder/core";
import { filterFromPreferences, type JobFilter } from "@job-finder/core/filters";
import { jobFilterCondition } from "@job-finder/core/filters/sql";
import type { JobPreferences } from "@job-finder/bridge";
import type { AppDb } from "../db/operations";
import { DIRECTORY_URL_PREFIX } from "./directory-jobs";

/** The profile's places alone: a company stays for offers in them, whatever the roles. */
function placesFilter(
  preferences: JobPreferences | null,
  recentOnly: boolean,
  maxAgeDays?: number,
): JobFilter | null {
  if (preferences === null) return null;
  return {
    ...filterFromPreferences(preferences, maxAgeDays),
    roles: [],
    workModes: [],
    employmentTypes: [],
    // A company is dropped for having nothing in the places at all, not for having nothing recent:
    // it may post again. The count of offers is of the recent ones, as the list shows them.
    ...(recentOnly ? {} : { maxAgeDays: 0 }),
  };
}

/**
 * Drops the companies a search added that, once scanned, have no open job in the profile's places:
 * they are marked removed, so they are not scanned again nor added again. A company the user added
 * by hand stays, and so does one not scanned yet. No place in the profile prunes nothing.
 * Returns how many were dropped.
 */
export async function pruneOffProfileCompanies(
  db: AppDb,
  preferences: JobPreferences | null,
  now = Date.now(),
): Promise<number> {
  const filter = placesFilter(preferences, false);
  const condition =
    filter === null || filter.places.length === 0 ? undefined : jobFilterCondition(filter);
  if (condition === undefined) return 0;
  const rows = await db
    .select({ id: companies.id })
    .from(companies)
    .where(
      and(
        eq(companies.origin, "discovery"),
        isNull(companies.excludedAt),
        notLike(companies.careersUrl, `${DIRECTORY_URL_PREFIX}%`),
        sql`exists (select 1 from run_events e where e.kind = 'company-scanned' and json_extract(e.detail, '$.companyId') = ${companies.id})`,
        sql`not exists (select 1 from ${jobs} where ${jobs.companyId} = ${companies.id} and ${jobs.closedAt} is null and ${condition})`,
      ),
    );
  if (rows.length === 0) return 0;
  await db
    .update(companies)
    .set({ excludedAt: now, excludedReason: "auto" })
    .where(
      inArray(
        companies.id,
        rows.map((row) => row.id),
      ),
    );
  return rows.length;
}

/** How many companies, followed or not, have an open job in the profile's places. */
export async function companiesWithOffers(
  db: AppDb,
  preferences: JobPreferences | null,
  maxAgeDays?: number,
): Promise<number> {
  const filter = placesFilter(preferences, true, maxAgeDays);
  const condition = filter === null ? undefined : jobFilterCondition(filter);
  const open = condition === undefined ? sql`1 = 1` : condition;
  const [row] = await db
    .select({ count: sql<number>`count(distinct ${jobs.companyId})` })
    .from(jobs)
    .where(and(isNull(jobs.closedAt), open));
  return Number(row?.count ?? 0);
}

/**
 * The companies only a job directory or feed gave, with the open jobs they have in the profile's
 * places: they are not scanned, so the Sources page lists them apart, by name.
 */
export async function directoryCompanies(
  db: AppDb,
  preferences: JobPreferences | null,
  maxAgeDays?: number,
): Promise<{ id: string; name: string; country: string | null; openJobs: number }[]> {
  const filter = placesFilter(preferences, true, maxAgeDays);
  const condition = filter === null ? undefined : jobFilterCondition(filter);
  const open = condition === undefined ? sql`1 = 1` : condition;
  const rows = await db
    .select({
      id: companies.id,
      name: companies.name,
      country: companies.country,
      openJobs: sql<number>`count(${jobs.id})`,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(
      and(
        isNull(jobs.closedAt),
        isNull(companies.excludedAt),
        like(companies.careersUrl, `${DIRECTORY_URL_PREFIX}%`),
        open,
      ),
    )
    .groupBy(companies.id)
    .orderBy(asc(sql`lower(${companies.name})`));
  return rows.map((row) => ({ ...row, openJobs: Number(row.openJobs) }));
}
