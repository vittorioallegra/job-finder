import { sql } from "drizzle-orm";
import type { AppDb } from "./operations";

/**
 * Sets each company's home country: the country most of its open jobs are located in. A company
 * whose jobs name no country gets null, which the places filter reads as "not known yet" and keeps.
 * Run at start and after each scan, since a scan changes the jobs.
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
}
