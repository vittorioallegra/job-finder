import type { AiTestResult } from "./ai";
import type { AppSettings, AppSettingsPatch } from "./settings";
import type { SecretName, SecretsStatus } from "./secrets";
import type { CvImportRequest, CvImportResult, Profile, ProfileRecord } from "./profile";

export * from "./ai";
export * from "./settings";
export * from "./secrets";
export * from "./ipc";
export * from "./profile";

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
  readonly ai: {
    /** Tests the saved AI settings and key from main. The key itself never reaches the renderer. */
    testConnection(): Promise<AiTestResult>;
  };
  readonly profile: {
    /** The saved profile, or null before onboarding. */
    get(): Promise<ProfileRecord | null>;
    save(profile: Profile): Promise<ProfileRecord>;
    /** Extracts a profile draft from a CV in the engine. Nothing is saved until `save`. */
    importCv(request: CvImportRequest): Promise<CvImportResult>;
  };
}
