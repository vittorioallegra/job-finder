import type { AiTestResult } from "./ai";
import type { AutofillStartRequest, AutofillStartResult } from "./autofill";
import type {
  ApplicationBookmarkRequest,
  ApplicationCheckRequest,
  ApplicationDetail,
  ApplicationDetailRequest,
  ApplicationExportResult,
  ApplicationStartRequest,
  ApplicationStartResult,
  ApplicationSummary,
  ApplicationUpdateRequest,
  ApplicationUpdateResult,
  DuplicateCheck,
} from "./applications";
import type {
  ApplicationDocuments,
  DocumentExportRequest,
  DocumentExportResult,
  DocumentGenerateRequest,
  DocumentGenerateResult,
  DocumentGetRequest,
  DocumentSaveRequest,
  DocumentSaveResult,
} from "./documents";
import type { AppStatus, OpenNewJobsRequest } from "./app";
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
export * from "./applications";
export * from "./documents";
export * from "./autofill";
export * from "./app";

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
  readonly applications: {
    /** Every application, newest status change first. The renderer filters and groups them. */
    list(): Promise<ApplicationSummary[]>;
    /** One application with its timeline, or null when it does not exist. */
    detail(request: ApplicationDetailRequest): Promise<ApplicationDetail | null>;
    /** Bookmarks a job (an application with status bookmarked) or removes that bookmark. Resolves false when the job does not exist. */
    bookmark(request: ApplicationBookmarkRequest): Promise<boolean>;
    /** The duplicate warning for a job: applications for the same job and for the same company. */
    check(request: ApplicationCheckRequest): Promise<DuplicateCheck>;
    /** Starts preparing a job. Refused with the warning until the confirmations it needs are given. */
    start(request: ApplicationStartRequest): Promise<ApplicationStartResult>;
    /** Moves an application to a status the status machine allows, and/or adds a note. */
    update(request: ApplicationUpdateRequest): Promise<ApplicationUpdateResult>;
    /** Asks for a file with a native dialog and writes every application to it as CSV. */
    exportCsv(): Promise<ApplicationExportResult>;
  };
  readonly autofill: {
    /**
     * Opens the application's form in a separate window, fills the fields the profile covers and
     * highlights the rest. The app never submits: the user reviews and submits in that window.
     */
    start(request: AutofillStartRequest): Promise<AutofillStartResult>;
  };
  readonly documents: {
    /** The stored CV and cover letter of an application, each null until it is generated. */
    get(request: DocumentGetRequest): Promise<ApplicationDocuments>;
    /** Generates a CV or a cover letter with the AI in the engine. Replaces the stored draft of that kind. */
    generate(request: DocumentGenerateRequest): Promise<DocumentGenerateResult>;
    /** Saves the user's edits to a stored document, after the profile checks. */
    save(request: DocumentSaveRequest): Promise<DocumentSaveResult>;
    /** Renders the stored document to a PDF in the application's folder. */
    exportPdf(request: DocumentExportRequest): Promise<DocumentExportResult>;
    /** Shows an exported PDF in the file manager. Resolves false when there is none yet. */
    reveal(request: DocumentExportRequest): Promise<boolean>;
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
  readonly app: {
    /** The engine state and the newer release, if the update check found one. */
    status(): Promise<AppStatus>;
    /** Subscribes to status changes; returns the function that unsubscribes. */
    onStatusChange(listener: (status: AppStatus) => void): () => void;
    /** Opens the release page of the newer version in the browser. Resolves false when there is none. */
    openUpdate(): Promise<boolean>;
    /** A notification click waiting for the window to open the new jobs; taking it clears it. */
    takePendingOpen(): Promise<OpenNewJobsRequest | null>;
    /** Subscribes to notification clicks while the window is open; returns the function that unsubscribes. */
    onOpenNewJobs(listener: (request: OpenNewJobsRequest) => void): () => void;
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
