import type { AiTestResult } from "./ai";
import type { AppSettings, AppSettingsPatch } from "./settings";
import type { SecretName, SecretsStatus } from "./secrets";
import type { CvImportRequest, CvImportResult, Profile, ProfileRecord } from "./profile";
import type { DiscoverySearchRequest, DiscoverySearchResult } from "./discovery";
import type {
  CompanyAddRequest,
  CompanyAddResult,
  CompanyRecord,
  IngestEvent,
  IngestStartResult,
  JobListItem,
  LatestRun,
} from "./ingest";

export * from "./ai";
export * from "./ingest";
export * from "./discovery";
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
  readonly companies: {
    /** Companies the engine scans, in the order they were added. */
    list(): Promise<CompanyRecord[]>;
    /** Adds a company from its careers URL. The ATS and its board are detected from the URL. */
    add(input: CompanyAddRequest): Promise<CompanyAddResult>;
  };
  readonly jobs: {
    /** Open jobs, newest first. */
    list(): Promise<JobListItem[]>;
  };
  readonly discovery: {
    /** Searches the web for ATS boards matching the criteria. Found boards are not added until the user adds them. */
    search(input: DiscoverySearchRequest): Promise<DiscoverySearchResult>;
  };
  readonly ingest: {
    /** Starts a run over every company, or only over `companyId` (a retry). Progress arrives through `onProgress`. */
    start(companyId?: string): Promise<IngestStartResult>;
    cancel(runId: string): Promise<void>;
    /** The latest run and its log, or null before any run. */
    latest(): Promise<LatestRun | null>;
    /** Subscribes to run progress; returns the function that unsubscribes. */
    onProgress(listener: (event: IngestEvent) => void): () => void;
  };
}
