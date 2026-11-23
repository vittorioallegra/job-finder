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
