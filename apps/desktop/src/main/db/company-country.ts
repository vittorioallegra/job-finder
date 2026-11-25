import { and, eq, isNull, sql } from "drizzle-orm";
import { companies, jobs } from "@job-finder/core";
import { countryFromHost, normalizeLocation, type JobLocation } from "@job-finder/core/normalize";
import type { AppDb } from "./operations";

/**
 * Adds the country to stored job locations that lack one, by reading their text again: postings
 * saved before the city list existed name only "Milano" or "Boston, MA". A scan does this for the
 * jobs it reads; this brings the rest along at start.
 */
export async function backfillLocationCountries(db: AppDb): Promise<number> {
  const rows = await db
    .select({ id: jobs.id, locations: jobs.locations })
    .from(jobs)
    .where(isNull(jobs.closedAt));
  let changed = 0;
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.locations);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    let touched = false;
    const next = (parsed as JobLocation[]).map((location) => {
      if (typeof location?.raw !== "string" || location.countryCode !== undefined) return location;
      const code = normalizeLocation(location.raw).countryCode;
      if (code === undefined) return location;
      touched = true;
      return { ...location, countryCode: code };
    });
    if (!touched) continue;
    await db
      .update(jobs)
      .set({ locations: JSON.stringify(next) })
      .where(eq(jobs.id, row.id));
    changed += 1;
  }
  return changed;
}

/**
 * Sets each company's home country: the country most of its open jobs are located in, or, when
 * its jobs name none, the country of its own web address (`azienda.it`). A company with neither
 * has none. Run at start and after each scan, since a scan changes the jobs.
 */
export async function refreshCompanyCountries(db: AppDb): Promise<void> {
  await db.run(sql`
    update companies set country = (
      select json_extract(loc.value, '$.countryCode')
      from jobs j, json_each(j.locations) as loc
      where j.company_id = companies.id
        and j.closed_at is null
        and json_extract(loc.value, '$.countryCode') is not null
      group by json_extract(loc.value, '$.countryCode')
      order by count(*) desc, json_extract(loc.value, '$.countryCode')
      limit 1
    )
  `);
  const unknown = await db
    .select({ id: companies.id, careersUrl: companies.careersUrl })
    .from(companies)
    .where(and(isNull(companies.country)));
  for (const company of unknown) {
    let host: string;
    try {
      host = new URL(company.careersUrl).hostname;
    } catch {
      continue;
    }
    const code = countryFromHost(host);
    if (code !== undefined) {
      await db.update(companies).set({ country: code }).where(eq(companies.id, company.id));
    }
  }
}
