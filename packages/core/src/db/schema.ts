import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
