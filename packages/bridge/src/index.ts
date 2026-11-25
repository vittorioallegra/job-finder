import type { AiModelSource, AiModelsResult, AiTestResult } from "./ai";
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
  ApplicationRemoveRequest,
  ApplicationRemoveResult,
  ApplicationUpdateResult,
  DuplicateCheck,
} from "./applications";
import type {
  ApplicationDocuments,
  DocumentExportRequest,
  DocumentExportResult,
  DocumentGenerateRequest,
  DocumentPreviewResult,
  DocumentSetLanguageRequest,
  DocumentGenerateResult,
  DocumentGetRequest,
  DocumentSaveRequest,
  DocumentSaveResult,
} from "./documents";
import type { AppStatus, OpenNewJobsRequest } from "./app";
import type { AppSettings, AppSettingsPatch } from "./settings";
import type { SecretName, SecretsStatus } from "./secrets";
import type { CvImportRequest, CvImportResult, Profile, ProfileRecord } from "./profile";
import type { BackgroundReadStatus, ProfileDiscoveryResult } from "./discovery";
import type { ScoreStartRequest, ScoreStartResult } from "./scoring";
import type { JobDetail, JobDetailRequest, JobFlagRequest, JobsListRequest } from "./jobs";
import type {
  CompanyRecord,
  ExcludedCompany,
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
    /**
     * The models a provider offers, for the model menu. `baseUrl` is the value being edited. Main
     * adds the saved key only for the provider's own address; Ollama is asked only on loopback.
     */
    models(request: { source: AiModelSource; baseUrl: string }): Promise<AiModelsResult>;
  };
  readonly profile: {
    /** The saved profile, or null before onboarding. */
    get(): Promise<ProfileRecord | null>;
    save(profile: Profile): Promise<ProfileRecord>;
    /** Extracts a profile draft from a CV in the engine. Nothing is saved until `save`. */
    importCv(request: CvImportRequest): Promise<CvImportResult>;
    /** Stops a running import; the import then answers `cancelled`. Nothing happens when none runs. */
    cancelImport(): Promise<void>;
  };
  readonly companies: {
    /** Companies the engine scans, in the order they were added. */
    list(): Promise<CompanyRecord[]>;
    /** How many companies, followed or not, have open jobs in the profile's places. */
    summary(): Promise<{ withOffers: number }>;
    /**
     * Removes a company from the sources: no more scans, its jobs leave the lists, and the company
     * search does not add it again. Resolves false when unknown.
     */
    remove(companyId: string): Promise<boolean>;
    /** The companies left out of the sources, the person's and the automatic ones. */
    excluded(): Promise<ExcludedCompany[]>;
    /** Brings a left-out company back into the sources, kept there whatever the profile's places. Resolves false when unknown. */
    restore(companyId: string): Promise<boolean>;
  };
  readonly jobs: {
    /** Open jobs matching the filter, in the requested order. */
    list(request: JobsListRequest): Promise<JobListItem[]>;
    /** One job with all its source links, or null when it does not exist. */
    detail(request: JobDetailRequest): Promise<JobDetail | null>;
    /** Dismisses or restores a job, or marks it viewed. Resolves false when the job does not exist. */
    flag(request: JobFlagRequest): Promise<boolean>;
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
    /** Deletes an application that was not submitted yet, with its notes and documents. */
    remove(request: ApplicationRemoveRequest): Promise<ApplicationRemoveResult>;
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
    /** Saves the language the user chose for this application's documents. Resolves false when the application does not exist. */
    setLanguage(request: DocumentSetLanguageRequest): Promise<boolean>;
    /** Saves the user's edits to a stored document, after the profile checks. */
    save(request: DocumentSaveRequest): Promise<DocumentSaveResult>;
    /** Renders the stored document to a PDF in the application's folder. */
    exportPdf(request: DocumentExportRequest): Promise<DocumentExportResult>;
    /** The HTML the stored document is printed from, to preview it as it will look in the PDF. */
    preview(request: DocumentExportRequest): Promise<DocumentPreviewResult>;
  };
  readonly scores: {
    /**
     * Scores the open jobs with the AI, on the current profile version. Runs in the engine and
     * resolves when the run ends; the key never reaches the renderer.
     */
    start(input: ScoreStartRequest): Promise<ScoreStartResult>;
  };
  readonly discovery: {
    /** Finds and adds the companies the profile's roles and places point to, then scans them. */
    fromProfile(): Promise<ProfileDiscoveryResult>;
    /** What the background reading that follows a profile search is doing. */
    backgroundStatus(): Promise<BackgroundReadStatus>;
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
