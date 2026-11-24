import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { EXPLANATION_LANGUAGES } from "../ranking/prompt";
import { APPLICATION_STATUSES } from "../applications/status";
import { DOCUMENT_KINDS } from "../documents/schema";

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
  /**
   * When the user removed the company from the sources. It is no longer scanned, its jobs leave
   * the lists, and the company search does not add it again; applications keep their jobs.
   */
  excludedAt: integer("excluded_at"),
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

/**
 * The affinity score of one job for one profile version (0-100, with the model's explanation). A row
 * is replaced when the job content, the model or the prompt version changes. A profile version change
 * starts new rows, so the list reads only the rows of the current version. `job_hash`, `profile_hash`,
 * `model`, `prompt_version` and `explanation_language` are the cache key a row is reused under.
 */
export const jobScores = sqliteTable(
  "job_scores",
  {
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id),
    profileVersion: integer("profile_version").notNull(),
    jobHash: text("job_hash").notNull(),
    profileHash: text("profile_hash").notNull(),
    model: text("model").notNull(),
    promptVersion: integer("prompt_version").notNull(),
    /** The language of `explanation` (the UI language at scoring time). Rows before it were English. */
    explanationLanguage: text("explanation_language", { enum: EXPLANATION_LANGUAGES })
      .notNull()
      .default("en"),
    score: integer("score").notNull(),
    explanation: text("explanation").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.profileVersion] }),
    index("job_scores_profile_version_idx").on(table.profileVersion),
    check("job_scores_score_range", sql`${table.score} between 0 and 100`),
  ],
);

/** A saved search: a name and the typed job filter as JSON. The scheduler reads these later. */
export const savedSearches = sqliteTable("saved_searches", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  filters: text("filters").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * The user's flags on a job: `dismissed_at` hides it from the results, `viewed_at` ends its "new"
 * badge. A job without a row is neither dismissed nor viewed.
 */
export const jobFlags = sqliteTable("job_flags", {
  jobId: text("job_id")
    .primaryKey()
    .references(() => jobs.id),
  dismissedAt: integer("dismissed_at"),
  viewedAt: integer("viewed_at"),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * An application to one job. A bookmark is an application with status `bookmarked`. A job can have
 * several applications over time (a duplicate needs a confirmation). `status_changed_at` is the time of
 * the last status change; the duplicate window reads it.
 */
export const applications = sqliteTable(
  "applications",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id),
    status: text("status", { enum: APPLICATION_STATUSES }).notNull(),
    createdAt: integer("created_at").notNull(),
    statusChangedAt: integer("status_changed_at").notNull(),
  },
  (table) => [index("applications_job_idx").on(table.jobId)],
);

/**
 * The timeline of an application: one row per status change and per note, in time order. `status` is
 * the status after the event. `note` is the user's text, or null for a plain status change.
 */
export const applicationEvents = sqliteTable(
  "application_events",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id),
    status: text("status", { enum: APPLICATION_STATUSES }).notNull(),
    note: text("note"),
    at: integer("at").notNull(),
  },
  (table) => [index("application_events_application_idx").on(table.applicationId)],
);

/**
 * The editable source of an application's CV or cover letter (one row per application and kind).
 * `content` is the JSON of the document; `exported_at` is the time of the last PDF export, so an
 * edit after it (`updated_at` later) shows that the PDF is out of date.
 */
export const applicationDocuments = sqliteTable(
  "application_documents",
  {
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id),
    kind: text("kind", { enum: DOCUMENT_KINDS }).notNull(),
    content: text("content").notNull(),
    /** The document's language (en or it). Null for documents generated before languages were stored. */
    language: text("language"),
    updatedAt: integer("updated_at").notNull(),
    exportedAt: integer("exported_at"),
  },
  (table) => [
    primaryKey({ columns: [table.applicationId, table.kind] }),
    check("application_documents_kind", sql`${table.kind} in ('cv', 'cover-letter')`),
  ],
);
