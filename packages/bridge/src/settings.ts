import { z } from "zod";

export const AI_PROVIDERS = ["anthropic", "openai", "openai-compatible"] as const;
export const UI_LANGUAGES = ["system", "en", "it"] as const;
export const CLOSE_BEHAVIORS = ["ask", "keep-running", "quit"] as const;
export const SEARCH_PROVIDERS = ["duckduckgo", "brave", "tavily", "serper"] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];
export type UiLanguage = (typeof UI_LANGUAGES)[number];
export type CloseBehavior = (typeof CLOSE_BEHAVIORS)[number];
export type SearchProvider = (typeof SEARCH_PROVIDERS)[number];

/** Bounds shared by the settings screen (native inputs) and the main-process validation. */
export const SETTING_LIMITS = {
  contextSizeMin: 512,
  contextSizeMax: 1_000_000,
  schedulerIntervalHoursMin: 1,
  schedulerIntervalHoursMax: 168,
  jobsMaxAgeDaysMin: 1,
  jobsMaxAgeDaysMax: 365,
  modelMaxLength: 200,
  baseUrlMaxLength: 500,
} as const;

function isEmptyOrHttpUrl(value: string): boolean {
  if (value === "") {
    return true;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const aiSection = z.strictObject({
  /**
   * Whether the AI features are on. Off is the starting state: nothing leaves the machine, and the
   * features that need an AI (CV import, affinity scores, tailored documents, the form fallback,
   * reading careers pages without a board) stay unavailable.
   */
  enabled: z.boolean().default(false),
  /** The cloud consent the user gave, as `aiConsentTarget`: lets a scan score new jobs by itself. */
  consentTarget: z.string().max(600).default(""),
  provider: z.enum(AI_PROVIDERS),
  model: z.string().trim().max(SETTING_LIMITS.modelMaxLength),
  baseUrl: z
    .string()
    .trim()
    .max(SETTING_LIMITS.baseUrlMaxLength)
    .refine(isEmptyOrHttpUrl, "baseUrl must be an http or https URL"),
  contextSize: z
    .number()
    .int()
    .min(SETTING_LIMITS.contextSizeMin)
    .max(SETTING_LIMITS.contextSizeMax),
});

const searchSection = z.strictObject({
  duckduckgo: z.boolean(),
  brave: z.boolean(),
  tavily: z.boolean(),
  serper: z.boolean(),
});

const uiSection = z.strictObject({ language: z.enum(UI_LANGUAGES) });

const notificationsSection = z.strictObject({ enabled: z.boolean() });

const schedulerSection = z.strictObject({
  intervalHours: z
    .number()
    .int()
    .min(SETTING_LIMITS.schedulerIntervalHoursMin)
    .max(SETTING_LIMITS.schedulerIntervalHoursMax),
});

const jobsSection = z.strictObject({
  /** Jobs posted longer ago than this are not shown, scored or kept. */
  maxAgeDays: z
    .number()
    .int()
    .min(SETTING_LIMITS.jobsMaxAgeDaysMin)
    .max(SETTING_LIMITS.jobsMaxAgeDaysMax),
});

const appSection = z.strictObject({
  closeBehavior: z.enum(CLOSE_BEHAVIORS),
  launchAtLogin: z.boolean(),
});

const updatesSection = z.strictObject({ checkEnabled: z.boolean() });

/** Each section is stored as one JSON row in the settings table, so a section is the unit of validation. */
export const SETTINGS_SECTIONS = {
  ai: aiSection,
  search: searchSection,
  ui: uiSection,
  notifications: notificationsSection,
  scheduler: schedulerSection,
  jobs: jobsSection,
  app: appSection,
  updates: updatesSection,
} as const;

export const AppSettingsSchema = z
  .strictObject(SETTINGS_SECTIONS)
  .superRefine((settings, context) => {
    if (settings.ai.provider === "openai-compatible" && settings.ai.baseUrl === "") {
      context.addIssue({
        code: "custom",
        path: ["ai", "baseUrl"],
        message: "An OpenAI-compatible provider needs a base URL",
      });
    }
  });

/** A patch names only the sections and keys it changes; every level is optional. */
export const AppSettingsPatchSchema = z
  .strictObject({
    ai: aiSection.partial(),
    search: searchSection.partial(),
    ui: uiSection.partial(),
    notifications: notificationsSection.partial(),
    scheduler: schedulerSection.partial(),
    jobs: jobsSection.partial(),
    app: appSection.partial(),
    updates: updatesSection.partial(),
  })
  .partial();

export type AppSettings = z.output<typeof AppSettingsSchema>;
export type AppSettingsSection = keyof typeof SETTINGS_SECTIONS;
export type AppSettingsPatch = z.input<typeof AppSettingsPatchSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  ai: {
    enabled: false,
    consentTarget: "",
    provider: "anthropic",
    model: "",
    baseUrl: "",
    contextSize: 8192,
  },
  search: { duckduckgo: true, brave: false, tavily: false, serper: false },
  ui: { language: "system" },
  notifications: { enabled: true },
  scheduler: { intervalHours: 24 },
  jobs: { maxAgeDays: 30 },
  app: { closeBehavior: "ask", launchAtLogin: false },
  updates: { checkEnabled: true },
};

/** Merges a patch into settings section by section and validates the result. Throws on invalid input. */
export function applySettingsPatch(current: AppSettings, patch: AppSettingsPatch): AppSettings {
  const changes = AppSettingsPatchSchema.parse(patch);
  const merged: Record<string, unknown> = {};
  for (const section of Object.keys(SETTINGS_SECTIONS) as AppSettingsSection[]) {
    merged[section] = { ...current[section], ...changes[section] };
  }
  return AppSettingsSchema.parse(merged);
}
