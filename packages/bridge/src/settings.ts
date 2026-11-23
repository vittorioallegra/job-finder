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

const appSection = z.strictObject({
  closeBehavior: z.enum(CLOSE_BEHAVIORS),
  launchAtLogin: z.boolean(),
});

const updatesSection = z.strictObject({ checkEnabled: z.boolean() });

const secretsSection = z.strictObject({ allowBasicText: z.boolean() });

/** Each section is stored as one JSON row in the settings table, so a section is the unit of validation. */
export const SETTINGS_SECTIONS = {
  ai: aiSection,
  search: searchSection,
  ui: uiSection,
  notifications: notificationsSection,
  scheduler: schedulerSection,
  app: appSection,
  updates: updatesSection,
  secrets: secretsSection,
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
    app: appSection.partial(),
    updates: updatesSection.partial(),
    secrets: secretsSection.partial(),
  })
  .partial();

export type AppSettings = z.output<typeof AppSettingsSchema>;
export type AppSettingsSection = keyof typeof SETTINGS_SECTIONS;
export type AppSettingsPatch = z.input<typeof AppSettingsPatchSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  ai: { provider: "anthropic", model: "", baseUrl: "", contextSize: 8192 },
  search: { duckduckgo: true, brave: false, tavily: false, serper: false },
  ui: { language: "system" },
  notifications: { enabled: true },
  scheduler: { intervalHours: 24 },
  app: { closeBehavior: "ask", launchAtLogin: false },
  updates: { checkEnabled: true },
  secrets: { allowBasicText: false },
};
