import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { companies, jobSources, jobs, runs, settings } from "@job-finder/core";
import { normalizeCompanyName } from "@job-finder/core/discovery";
import { lookupRequest, planBatch } from "@job-finder/core/ingest";
import type { NormalizedJob } from "@job-finder/core/normalize";
import { lookupExisting, persistPlan } from "../db/ingest-operations";
import type { AppDb } from "../db/operations";

/** Run kind of a store of directory postings; the scan screens only read `ingest` runs. */
export const DIRECTORY_RUN_KIND = "directory";

/** Companies created for a directory's postings have an address of this form, never scanned or listed. */
export const DIRECTORY_URL_PREFIX = "directory:";

/** A directory posting not seen for this long is closed: the directory no longer lists it. */
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 50;
const CURSOR_KEY = "directory.wide-scan.cursor";

export interface DirectoryJobStore {
  /** Stores the postings under their companies, and closes the directory's postings that went unseen. Returns how many were read. */
  store(postings: readonly NormalizedJob[]): Promise<number>;
  /** Where the next wide scan slice starts. */
  wideCursor: { get(): Promise<number>; set(value: number): Promise<void> };
}

export function createDirectoryJobStore(
  db: AppDb,
  now: () => number = () => Date.now(),
  newId: () => string = () => crypto.randomUUID(),
): DirectoryJobStore {
  return {
    wideCursor: {
      async get() {
        const [row] = await db.select().from(settings).where(eq(settings.key, CURSOR_KEY)).limit(1);
        const value = Number(row?.value);
        return Number.isFinite(value) && value >= 0 ? value : 0;
      },
      async set(value) {
        await db
          .insert(settings)
          .values({ key: CURSOR_KEY, value: String(value), updatedAt: now() })
          .onConflictDoUpdate({
            target: settings.key,
            set: { value: String(value), updatedAt: now() },
          });
      },
    },
    async store(postings) {
      if (postings.length === 0) return 0;
      const runId = newId();
      const startedAt = now();
      await db
        .insert(runs)
        .values({ id: runId, kind: DIRECTORY_RUN_KIND, status: "running", startedAt });

      const byCompany = new Map<string, { name: string; jobs: NormalizedJob[] }>();
      for (const posting of postings) {
        const key = normalizeCompanyName(posting.companyName);
        if (key === "") continue;
        const group = byCompany.get(key) ?? { name: posting.companyName, jobs: [] };
        group.jobs.push(posting);
        byCompany.set(key, group);
      }

      let stored = 0;
      for (const [key, group] of byCompany) {
        const careersUrl = `${DIRECTORY_URL_PREFIX}${key}`;
        let [company] = await db
          .select()
          .from(companies)
          .where(eq(companies.careersUrl, careersUrl))
          .limit(1);
        if (!company) {
          const created = {
            id: newId(),
            name: group.name,
            careersUrl,
            ats: null,
            slug: null,
            createdAt: startedAt,
            excludedAt: null,
            country: null,
          };
          await db.insert(companies).values(created);
          company = created;
        }
        // A company the user removed stays out, whatever the directory lists.
        if (company.excludedAt !== null) continue;
        for (let start = 0; start < group.jobs.length; start += BATCH_SIZE) {
          const batch = group.jobs.slice(start, start + BATCH_SIZE);
          const existing = await lookupExisting(db, lookupRequest(batch));
          const plan = planBatch({
            companyId: company.id,
            runId,
            seenAt: startedAt,
            jobs: batch,
            existing,
            newId,
          });
          await persistPlan(db, plan);
          stored += batch.length;
        }
      }

      // Postings of these companies that no directory or wide scan listed for a month are closed.
      const cutoff = startedAt - STALE_AFTER_MS;
      const stale = and(
        sql`${jobSources.companyId} in (select ${companies.id} from ${companies} where ${companies.careersUrl} like ${`${DIRECTORY_URL_PREFIX}%`})`,
        lt(jobSources.lastSeenAt, cutoff),
        isNull(jobSources.closedAt),
      );
      await db.update(jobSources).set({ closedAt: startedAt }).where(stale);
      await db
        .update(jobs)
        .set({ closedAt: startedAt })
        .where(
          and(
            isNull(jobs.closedAt),
            sql`not exists (select 1 from ${jobSources} where ${jobSources.jobId} = ${jobs.id} and ${jobSources.closedAt} is null)`,
          ),
        );

      await db
        .update(runs)
        .set({ status: "succeeded", finishedAt: now() })
        .where(eq(runs.id, runId));
      return stored;
    },
  };
}
