import {
  IPC_REQUEST_SCHEMAS,
  type AppStatus,
  type OpenNewJobsRequest,
  type DocumentExportRequest,
  type DocumentGenerateRequest,
  type DocumentSetLanguageRequest,
  type DocumentGetRequest,
  type DocumentSaveRequest,
  type ApplicationBookmarkRequest,
  type AutofillStartRequest,
  type ApplicationCheckRequest,
  type ApplicationDetailRequest,
  type ApplicationExportResult,
  type ApplicationStartRequest,
  type ApplicationRemoveRequest,
  type ApplicationUpdateRequest,
  type AppSettingsPatch,
  type AppSettings,
  type CvImportRequest,
  type IngestStartRequest,
  type IpcChannel,
  type IpcRequest,
  type JobDetailRequest,
  type JobFlagRequest,
  type JobsListRequest,
  type ScoreStartRequest,
  type SecretName,
} from "@job-finder/bridge";
import type { Profile } from "@job-finder/core/profile";
import type { AiConnectionService } from "../ai/connection";
import type { IngestRepository } from "../ingest/repository";
import type { IngestionService } from "../ingest/service";
import type { CvImportService } from "../profile/cv-import";
import type { DiscoveryService } from "../discovery/service";
import type { ProfileDiscovery } from "../discovery/from-profile";
import type { ScoringService } from "../scoring/service";
import type { ApplicationRepository } from "../applications/repository";
import type { DocumentService } from "../documents/service";
import type { AutofillService } from "../autofill/service";
import type { ProfileRepository } from "../profile/repository";
import { originOf } from "../security/origin";
import type { SecretStore } from "../secrets/store";
import type { SettingsRepository } from "../settings/repository";

/** What the renderer may read of the app's own state, and open. */
export interface AppStatusService {
  status(): AppStatus;
  /** Opens the release page of the newer version in the browser. Resolves false when there is none. */
  openUpdate(): Promise<boolean>;
  /** A notification click waiting for the window; taking it clears it. */
  takePendingOpen(): OpenNewJobsRequest | null;
}

export interface IpcServices {
  settings: SettingsRepository;
  app: AppStatusService;
  /** Runs after a settings update is stored, for the settings that act outside the database. */
  afterSettingsUpdate: (next: AppSettings) => void;
  secrets: SecretStore;
  ai: AiConnectionService;
  profile: ProfileRepository;
  cvImport: CvImportService;
  repository: IngestRepository;
  /** How many companies have open jobs in the profile's places. */
  companySummary: () => Promise<{ withOffers: number }>;
  ingestion: IngestionService;
  discovery: DiscoveryService;
  profileDiscovery: ProfileDiscovery;
  scoring: ScoringService;
  applications: ApplicationRepository;
  applicationExport: { exportCsv(): Promise<ApplicationExportResult> };
  documents: DocumentService;
  autofill: AutofillService;
}

/** The parts of an Electron invoke event that the sender check reads. */
export interface InvokeSender {
  senderFrame: { readonly url: string; readonly parent: unknown } | null;
}

/** Electron's `ipcMain.handle` shape, reduced to what registration needs. */
export interface IpcRegistrar {
  handle(channel: string, listener: (event: InvokeSender, raw: unknown) => Promise<unknown>): void;
}

/**
 * Only the app's own top-level page may invoke channels: the frame must sit at the top of the
 * tree and its origin must equal the renderer origin (`app://renderer` or the dev server).
 */
export function isTrustedSender(event: InvokeSender, allowedOrigin: string): boolean {
  const frame = event.senderFrame;
  if (!frame || frame.parent !== null) {
    return false;
  }
  return originOf(frame.url) === allowedOrigin;
}

/** Runs one channel: sender check first, then payload validation, then the service call. */
export async function handleInvoke(
  channel: IpcChannel,
  services: IpcServices,
  event: InvokeSender,
  raw: unknown,
  allowedOrigin: string,
): Promise<unknown> {
  if (!isTrustedSender(event, allowedOrigin)) {
    throw new Error(`IPC channel ${channel} rejected: untrusted sender`);
  }
  const payload = IPC_REQUEST_SCHEMAS[channel].parse(raw);
  switch (channel) {
    case "settings:get":
      return services.settings.get();
    case "settings:update": {
      const patch = payload as AppSettingsPatch;
      const next = await services.settings.update(patch);
      services.afterSettingsUpdate(next);
      return next;
    }
    case "secrets:status":
      return services.secrets.status();
    case "secrets:set": {
      const { name, value } = payload as { name: SecretName; value: string };
      return services.secrets.set(name, value);
    }
    case "secrets:clear": {
      const { name } = payload as { name: SecretName };
      return services.secrets.clear(name);
    }
    case "ai:test-connection":
      return services.ai.testConnection();
    case "ai:models":
      return services.ai.listModels(payload as IpcRequest<"ai:models">);
    case "app:status":
      return services.app.status();
    case "app:open-update":
      return services.app.openUpdate();
    case "app:take-pending-open":
      return services.app.takePendingOpen();
    case "profile:get":
      return services.profile.get();
    case "profile:save":
      return services.profile.save(payload as Profile);
    case "profile:import-cv":
      return services.cvImport.importCv(payload as CvImportRequest);
    case "profile:cancel-import":
      services.cvImport.cancelImport();
      return undefined;
    case "companies:list":
      return services.repository.listCompanies();
    case "companies:summary":
      return services.companySummary();
    case "companies:excluded":
      return services.repository.listExcluded();
    case "companies:restore":
      return services.repository.restoreCompany((payload as { companyId: string }).companyId);
    case "companies:remove":
      return services.repository.removeCompany((payload as { companyId: string }).companyId);
    case "jobs:list":
      return services.repository.listJobs(payload as JobsListRequest);
    case "jobs:detail":
      return services.repository.jobDetail((payload as JobDetailRequest).jobId);
    case "jobs:flag":
      return services.repository.setJobFlag(payload as JobFlagRequest);
    case "applications:list":
      return services.applications.list();
    case "applications:detail":
      return services.applications.detail((payload as ApplicationDetailRequest).applicationId);
    case "applications:bookmark":
      return services.applications.bookmark(payload as ApplicationBookmarkRequest);
    case "applications:check":
      return services.applications.check((payload as ApplicationCheckRequest).jobId);
    case "applications:start":
      return services.applications.start(payload as ApplicationStartRequest);
    case "applications:update":
      return services.applications.update(payload as ApplicationUpdateRequest);
    case "applications:remove":
      return services.applications.remove((payload as ApplicationRemoveRequest).applicationId);
    case "applications:export":
      return services.applicationExport.exportCsv();
    case "ingest:start":
      return services.ingestion.start((payload as IngestStartRequest | undefined)?.companyId);
    case "discovery:background-status":
      return services.discovery.status();
    case "discovery:from-profile":
      return services.profileDiscovery.run();
    case "ingest:cancel":
      services.ingestion.cancel((payload as { runId: string }).runId);
      return undefined;
    case "ingest:latest":
      return services.repository.latestRun();
    case "scores:start":
      return services.scoring.start(payload as ScoreStartRequest);
    case "autofill:start":
      return services.autofill.start(payload as AutofillStartRequest);
    case "documents:get":
      return services.documents.get((payload as DocumentGetRequest).applicationId);
    case "documents:generate":
      return services.documents.generate(payload as DocumentGenerateRequest);
    case "documents:set-language":
      return services.documents.setLanguage(payload as DocumentSetLanguageRequest);
    case "documents:preview":
      return services.documents.preview(payload as DocumentExportRequest);
    case "documents:save":
      return services.documents.save(payload as DocumentSaveRequest);
    case "documents:export":
      return services.documents.exportPdf(payload as DocumentExportRequest);
  }
}

/** Registers every channel in the contract on `ipcMain`, guarded by `handleInvoke`. */
export function registerIpcHandlers(
  registrar: IpcRegistrar,
  services: IpcServices,
  allowedOrigin: string,
): void {
  for (const channel of Object.keys(IPC_REQUEST_SCHEMAS) as IpcChannel[]) {
    registrar.handle(channel, (event, raw) =>
      handleInvoke(channel, services, event, raw, allowedOrigin),
    );
  }
}
