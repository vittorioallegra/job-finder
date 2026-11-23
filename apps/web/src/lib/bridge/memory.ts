import {
  applySettingsPatch,
  DEFAULT_APP_SETTINGS,
  SECRET_NAMES,
  type AppSettings,
  type AppSettingsPatch,
  type JobFinderBridge,
  type SecretName,
  type SecretStorageInfo,
  type SecretsStatus,
} from "@job-finder/bridge";

export interface MemoryBridgeOptions {
  platform?: string;
  settings?: AppSettings;
  storage?: SecretStorageInfo;
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
  };
}
