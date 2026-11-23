import {
  AppSettingsPatchSchema,
  type AiProvider,
  type AppSettings,
  type AppSettingsPatch,
  type CloseBehavior,
  type SearchProvider,
  type UiLanguage,
} from "@job-finder/bridge";

/** Form state. Numbers stay strings while typing and are parsed only when saving. */
export interface SettingsDraft {
  aiProvider: AiProvider;
  aiModel: string;
  aiBaseUrl: string;
  aiContextSize: string;
  search: Record<SearchProvider, boolean>;
  language: UiLanguage;
  notifications: boolean;
  intervalHours: string;
  closeBehavior: CloseBehavior;
  launchAtLogin: boolean;
  checkUpdates: boolean;
}

export function draftFromSettings(settings: AppSettings): SettingsDraft {
  return {
    aiProvider: settings.ai.provider,
    aiModel: settings.ai.model,
    aiBaseUrl: settings.ai.baseUrl,
    aiContextSize: String(settings.ai.contextSize),
    search: { ...settings.search },
    language: settings.ui.language,
    notifications: settings.notifications.enabled,
    intervalHours: String(settings.scheduler.intervalHours),
    closeBehavior: settings.app.closeBehavior,
    launchAtLogin: settings.app.launchAtLogin,
    checkUpdates: settings.updates.checkEnabled,
  };
}

/** Builds the full non-secret patch, or null when a value fails the shared settings schema. */
export function patchFromDraft(draft: SettingsDraft): AppSettingsPatch | null {
  const patch: AppSettingsPatch = {
    ai: {
      provider: draft.aiProvider,
      model: draft.aiModel,
      baseUrl: draft.aiProvider === "openai-compatible" ? draft.aiBaseUrl : "",
      contextSize: Number(draft.aiContextSize),
    },
    search: { ...draft.search },
    ui: { language: draft.language },
    notifications: { enabled: draft.notifications },
    scheduler: { intervalHours: Number(draft.intervalHours) },
    app: { closeBehavior: draft.closeBehavior, launchAtLogin: draft.launchAtLogin },
    updates: { checkEnabled: draft.checkUpdates },
  };
  const parsed = AppSettingsPatchSchema.safeParse(patch);
  return parsed.success ? patch : null;
}
