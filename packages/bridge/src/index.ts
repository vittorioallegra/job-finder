import type { AppSettings, AppSettingsPatch } from "./settings";
import type { SecretName, SecretsStatus } from "./secrets";

export * from "./settings";
export * from "./secrets";
export * from "./ipc";

/** Shape of the API the preload script exposes as `window.jobFinder`. Values never include secrets. */
export interface JobFinderBridge {
  readonly platform: string;
  readonly settings: {
    get(): Promise<AppSettings>;
    update(patch: AppSettingsPatch): Promise<AppSettings>;
  };
  readonly secrets: {
    status(): Promise<SecretsStatus>;
    set(name: SecretName, value: string): Promise<SecretsStatus>;
    clear(name: SecretName): Promise<SecretsStatus>;
  };
}
