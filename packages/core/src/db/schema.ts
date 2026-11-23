import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Run states. `interrupted` marks runs left `running` when the engine or app crashed. */
export const RUN_STATUSES = ["running", "succeeded", "failed", "cancelled", "interrupted"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Key-value application settings. Values are strings; typed settings are validated by their owners. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** One engine run (discovery, ingestion, scoring). Timestamps are epoch milliseconds. */
export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  status: text("status", { enum: RUN_STATUSES }).notNull(),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at"),
  message: text("message"),
});

/**
 * A company whose careers board is scanned. `ats` and `slug` come from the careers URL and are null
 * when no supported ATS was detected, so such a company cannot be scanned yet.
 */
export const companies = sqliteTable("companies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  careersUrl: text("careers_url").notNull().unique(),
  ats: text("ats"),
  slug: text("slug"),
  createdAt: integer("created_at").notNull(),
});

/**
 * One opening, shared by every source that reports it (cross-source dedupe by `fingerprint`).
 * Nested values are JSON: `locations` (JobLocation[]) and `salary` (Salary, or null).
 * `closed_at` is set once every source of the job is closed.
 */
export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    fingerprint: text("fingerprint").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    url: text("url").notNull(),
    applyUrl: text("apply_url").notNull(),
    language: text("language"),
    locations: text("locations").notNull(),
    workMode: text("work_mode").notNull(),
    remoteScope: text("remote_scope"),
    employmentType: text("employment_type").notNull(),
    seniority: text("seniority").notNull(),
    salary: text("salary"),
    visaSponsorship: text("visa_sponsorship").notNull(),
    /** Epoch milliseconds, from the posting's own date when the source gives one. */
    postedAt: integer("posted_at"),
    firstSeenAt: integer("first_seen_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    closedAt: integer("closed_at"),
  },
  (table) => [index("jobs_fingerprint_idx").on(table.fingerprint)],
);

/**
 * One posting as one source reports it. Identity is (source, source_job_id): the same posting
 * from two sources has two rows, both pointing at one job. `last_run_id` is the last run that
 * saw it; a complete scan of the company closes the rows it did not see in that run.
 */
export const jobSources = sqliteTable(
  "job_sources",
  {
    source: text("source").notNull(),
    sourceJobId: text("source_job_id").notNull(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    url: text("url").notNull(),
    applyUrl: text("apply_url").notNull(),
    lastRunId: text("last_run_id").notNull(),
    firstSeenAt: integer("first_seen_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    closedAt: integer("closed_at"),
  },
  (table) => [
    primaryKey({ columns: [table.source, table.sourceJobId] }),
    index("job_sources_company_idx").on(table.companyId),
    index("job_sources_job_idx").on(table.jobId),
  ],
);

/**
 * The run log: one row per progress event, ordered by `seq` within its run. `detail` is the JSON of
 * the event's remaining fields (company, job counts, failure code, final status). Codes only, no prose.
 */
export const runEvents = sqliteTable(
  "run_events",
  {
    runId: text("run_id")
      .notNull()
      .references(() => runs.id),
    seq: integer("seq").notNull(),
    at: integer("at").notNull(),
    kind: text("kind").notNull(),
    detail: text("detail").notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.seq] })],
);

/** The single user profile (row id 1). `data` is the JSON of the validated profile; `version` points at the scoring version. */
export const profile = sqliteTable("profile", {
  id: integer("id").primaryKey(),
  data: text("data").notNull(),
  version: integer("version").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** One row per scoring-relevant profile change. `snapshot` is the scoring JSON of that version. */
export const profileVersions = sqliteTable("profile_versions", {
  version: integer("version").primaryKey(),
  snapshot: text("snapshot").notNull(),
  createdAt: integer("created_at").notNull(),
});
