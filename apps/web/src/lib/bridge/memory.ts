import {
  applySettingsPatch,
  DEFAULT_APP_SETTINGS,
  SECRET_NAMES,
  type AiTestResult,
  type AppSettings,
  type AppSettingsPatch,
  type CvImportResult,
  type JobFinderBridge,
  type Profile,
  ProfileSchema,
  type ProfileRecord,
  type SecretName,
  type SecretStorageInfo,
  type SecretsStatus,
} from "@job-finder/bridge";

export interface MemoryBridgeOptions {
  platform?: string;
  settings?: AppSettings;
  storage?: SecretStorageInfo;
  /** Outcome of "test connection". Defaults to AI unavailable, since there is no engine here. */
  aiTest?: AiTestResult;
  /** Outcome of a CV import. Defaults to engine unavailable, since there is no engine here. */
  cvImport?: CvImportResult;
  /** A profile already saved before the page loads. Defaults to none (onboarding not done). */
  profile?: Profile;
}

/**
 * In-memory stand-in for `window.jobFinder`: used by web tests and by `pnpm dev`, where the page
 * runs without the desktop preload. Nothing is persisted and secret values are never kept.
 */
export function createMemoryBridge(options: MemoryBridgeOptions = {}): JobFinderBridge {
  let settings: AppSettings = structuredClone(options.settings ?? DEFAULT_APP_SETTINGS);
  const storage: SecretStorageInfo = options.storage ?? { mode: "encrypted", optInRequired: false };
  const keys = Object.fromEntries(SECRET_NAMES.map((name) => [name, false])) as Record<
    SecretName,
    boolean
  >;

  const status = async (): Promise<SecretsStatus> => ({ storage, keys: { ...keys } });
  let profile: ProfileRecord | null = options.profile
    ? { profile: options.profile, version: 1, updatedAt: 0 }
    : null;

  return {
    platform: options.platform ?? "darwin",
    settings: {
      get: async () => structuredClone(settings),
      update: async (patch: AppSettingsPatch) => {
        settings = applySettingsPatch(settings, patch);
        return structuredClone(settings);
      },
    },
    secrets: {
      status,
      set: async (name) => {
        keys[name] = true;
        return status();
      },
      clear: async (name) => {
        keys[name] = false;
        return status();
      },
    },
    ai: {
      testConnection: async () =>
        structuredClone(options.aiTest ?? { ok: false, code: "engine-unavailable" }),
    },
    profile: {
      get: async () => (profile ? structuredClone(profile) : null),
      save: async (input) => {
        const parsed = ProfileSchema.parse(input);
        const version =
          profile && JSON.stringify(profile.profile) === JSON.stringify(parsed)
            ? profile.version
            : (profile?.version ?? 0) + 1;
        profile = { profile: parsed, version, updatedAt: Date.now() };
        return structuredClone(profile);
      },
      importCv: async () =>
        structuredClone(options.cvImport ?? { ok: false, code: "engine-unavailable" }),
    },
  };
}
