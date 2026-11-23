import { inArray } from "drizzle-orm";
import { settings } from "@job-finder/core";
import {
  AppSettingsPatchSchema,
  AppSettingsSchema,
  DEFAULT_APP_SETTINGS,
  SETTINGS_SECTIONS,
  type AppSettings,
  type AppSettingsPatch,
  type AppSettingsSection,
} from "@job-finder/bridge";
import type { AppDb } from "../db/operations";

export interface SettingsRepository {
  get(): Promise<AppSettings>;
  /** Merges the patch section by section, validates the result and returns the stored settings. */
  update(patch: AppSettingsPatch): Promise<AppSettings>;
}

const SECTIONS = Object.keys(SETTINGS_SECTIONS) as AppSettingsSection[];

function rowKey(section: AppSettingsSection): string {
  return `settings.${section}`;
}

/** Reads one section; a missing or malformed row falls back to that section's defaults. */
function parseSection(section: AppSettingsSection, raw: string | undefined): unknown {
  const fallback = DEFAULT_APP_SETTINGS[section];
  if (raw === undefined) {
    return fallback;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fallback;
  }
  const parsed = SETTINGS_SECTIONS[section].safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

/** Settings live in the shared key-value table, one JSON row per section (`settings.<section>`). */
export function createSettingsRepository(db: AppDb): SettingsRepository {
  async function read(): Promise<AppSettings> {
    const rows = await db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(inArray(settings.key, SECTIONS.map(rowKey)));
    const stored = new Map(rows.map((row) => [row.key, row.value]));
    const values = Object.fromEntries(
      SECTIONS.map((section) => [section, parseSection(section, stored.get(rowKey(section)))]),
    );
    return AppSettingsSchema.parse(values);
  }

  return {
    get: read,
    async update(patch) {
      const changes = AppSettingsPatchSchema.parse(patch);
      const current = await read();
      const merged: Record<string, unknown> = {};
      for (const section of SECTIONS) {
        merged[section] = { ...current[section], ...changes[section] };
      }
      const next = AppSettingsSchema.parse(merged);
      const now = Date.now();
      for (const section of SECTIONS) {
        if (changes[section] === undefined) {
          continue;
        }
        const value = JSON.stringify(next[section]);
        await db
          .insert(settings)
          .values({ key: rowKey(section), value, updatedAt: now })
          .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } });
      }
      return next;
    },
  };
}
