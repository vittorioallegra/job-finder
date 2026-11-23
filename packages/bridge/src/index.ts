import type { AiTestResult } from "./ai";
import type { AppSettings, AppSettingsPatch } from "./settings";
import type { SecretName, SecretsStatus } from "./secrets";
import type { CvImportRequest, CvImportResult, Profile, ProfileRecord } from "./profile";
import type { DiscoverySearchRequest, DiscoverySearchResult } from "./discovery";
import type { ScoreStartRequest, ScoreStartResult } from "./scoring";
import type {
  JobDetail,
  JobDetailRequest,
  JobFlagRequest,
  JobsListRequest,
  SavedSearch,
  SavedSearchDeleteRequest,
  SavedSearchSaveRequest,
} from "./jobs";
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
export * from "./scoring";
export * from "./jobs";

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
    /** Open jobs matching the filter, in the requested order. */
    list(request: JobsListRequest): Promise<JobListItem[]>;
    /** One job with all its source links, or null when it does not exist. */
    detail(request: JobDetailRequest): Promise<JobDetail | null>;
    /** Dismisses or restores a job, or marks it viewed. Resolves false when the job does not exist. */
    flag(request: JobFlagRequest): Promise<boolean>;
  };
  readonly savedSearches: {
    list(): Promise<SavedSearch[]>;
    /** Creates a saved search, or replaces the one with the given id. Resolves null when that id is unknown. */
    save(request: SavedSearchSaveRequest): Promise<SavedSearch | null>;
    delete(request: SavedSearchDeleteRequest): Promise<void>;
  };
  readonly scores: {
    /**
     * Scores the open jobs with the AI, on the current profile version. Runs in the engine and
     * resolves when the run ends; the key never reaches the renderer.
     */
    start(input: ScoreStartRequest): Promise<ScoreStartResult>;
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
