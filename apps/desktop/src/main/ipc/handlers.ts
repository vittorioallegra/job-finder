import {
  IPC_REQUEST_SCHEMAS,
  type DocumentExportRequest,
  type DocumentGenerateRequest,
  type DocumentGetRequest,
  type DocumentSaveRequest,
  type ApplicationBookmarkRequest,
  type AutofillStartRequest,
  type ApplicationCheckRequest,
  type ApplicationDetailRequest,
  type ApplicationExportResult,
  type ApplicationStartRequest,
  type ApplicationUpdateRequest,
  type AppSettingsPatch,
  type CompanyAddRequest,
  type CvImportRequest,
  type DiscoverySearchRequest,
  type IngestStartRequest,
  type IpcChannel,
  type JobDetailRequest,
  type JobFlagRequest,
  type JobsListRequest,
  type SavedSearchDeleteRequest,
  type SavedSearchSaveRequest,
  type ScoreStartRequest,
  type SecretName,
} from "@job-finder/bridge";
import type { Profile } from "@job-finder/core/profile";
import type { AiConnectionService } from "../ai/connection";
import type { IngestRepository } from "../ingest/repository";
import type { IngestionService } from "../ingest/service";
import type { CvImportService } from "../profile/cv-import";
import type { DiscoveryService } from "../discovery/service";
import type { ScoringService } from "../scoring/service";
import type { SavedSearchRepository } from "../saved-searches/repository";
import type { ApplicationRepository } from "../applications/repository";
import type { DocumentService } from "../documents/service";
import type { AutofillService } from "../autofill/service";
import type { ProfileRepository } from "../profile/repository";
import { originOf } from "../security/origin";
import type { SecretStore } from "../secrets/store";
import type { SettingsRepository } from "../settings/repository";

export interface IpcServices {
  settings: SettingsRepository;
  secrets: SecretStore;
  ai: AiConnectionService;
  profile: ProfileRepository;
  cvImport: CvImportService;
  repository: IngestRepository;
  ingestion: IngestionService;
  discovery: DiscoveryService;
  scoring: ScoringService;
  savedSearches: SavedSearchRepository;
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
      if (patch.secrets?.allowBasicText !== undefined) {
        await services.secrets.onBasicTextAllowedChanged();
      }
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
    case "profile:get":
      return services.profile.get();
    case "profile:save":
      return services.profile.save(payload as Profile);
    case "profile:import-cv":
      return services.cvImport.importCv(payload as CvImportRequest);
    case "companies:list":
      return services.repository.listCompanies();
    case "companies:add":
      return services.repository.addCompany(payload as CompanyAddRequest);
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
    case "applications:export":
      return services.applicationExport.exportCsv();
    case "saved-searches:list":
      return services.savedSearches.list();
    case "saved-searches:save":
      return services.savedSearches.save(payload as SavedSearchSaveRequest);
    case "saved-searches:delete":
      await services.savedSearches.delete((payload as SavedSearchDeleteRequest).id);
      return undefined;
    case "ingest:start":
      return services.ingestion.start((payload as IngestStartRequest | undefined)?.companyId);
    case "discovery:search":
      return services.discovery.search(payload as DiscoverySearchRequest);
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
    case "documents:save":
      return services.documents.save(payload as DocumentSaveRequest);
    case "documents:export":
      return services.documents.exportPdf(payload as DocumentExportRequest);
    case "documents:reveal":
      return services.documents.reveal(payload as DocumentExportRequest);
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
