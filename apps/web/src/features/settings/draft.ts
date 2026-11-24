import {
  AppSettingsPatchSchema,
  type AppSettings,
  type AppSettingsPatch,
  type CloseBehavior,
  type SearchProvider,
  type UiLanguage,
} from "@job-finder/bridge";
import {
  aiChoiceFromSettings,
  aiSettingsFromChoice,
  choiceSetsContextSize,
  contextSizeFor,
  defaultContextSize,
  type AiChoice,
} from "./provider-choice";

/** Form state. Numbers stay strings while typing and are parsed only when saving. */
export interface SettingsDraft {
  /** The provider menu entry; Ollama is saved as the OpenAI-compatible provider. */
  aiProvider: AiChoice;
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
    aiProvider: aiChoiceFromSettings(settings.ai),
    aiModel: settings.ai.model,
    aiBaseUrl: settings.ai.baseUrl,
    // A hosted provider's size is set by the app; a switch to a server starts from the usual one.
    aiContextSize: String(
      choiceSetsContextSize(aiChoiceFromSettings(settings.ai))
        ? settings.ai.contextSize
        : defaultContextSize("ollama"),
    ),
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
      ...aiSettingsFromChoice({
        choice: draft.aiProvider,
        model: draft.aiModel,
        baseUrl: draft.aiBaseUrl,
      }),
      contextSize: contextSizeFor(draft.aiProvider, Number(draft.aiContextSize)),
    },
    // One service at a time: older settings with several switched on keep the chosen one only.
    search: searchFor(chosenSearch(draft.search)),
    ui: { language: draft.language },
    notifications: { enabled: draft.notifications },
    scheduler: { intervalHours: Number(draft.intervalHours) },
    app: { closeBehavior: draft.closeBehavior, launchAtLogin: draft.launchAtLogin },
    updates: { checkEnabled: draft.checkUpdates },
  };
  const parsed = AppSettingsPatchSchema.safeParse(patch);
  return parsed.success ? patch : null;
}

/** Keyed search services, in the order the settings list them. */
const KEYED_SEARCH_PROVIDERS: readonly SearchProvider[] = ["brave", "tavily", "serper"];

/** The one search service in use: the first keyed one switched on, else DuckDuckGo. */
export function chosenSearch(search: Record<SearchProvider, boolean>): SearchProvider {
  return KEYED_SEARCH_PROVIDERS.find((provider) => search[provider]) ?? "duckduckgo";
}

/** The search settings with only `provider` switched on. */
export function searchFor(provider: SearchProvider): Record<SearchProvider, boolean> {
  return { duckduckgo: false, brave: false, tavily: false, serper: false, [provider]: true };
}
