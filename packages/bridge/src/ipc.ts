import { z } from "zod";
import type { AppSettings } from "./settings";
import { AppSettingsPatchSchema } from "./settings";
import type { AiTestResult } from "./ai";
import type { SecretsStatus } from "./secrets";
import { SecretClearRequestSchema, SecretSetRequestSchema } from "./secrets";
import type { CvImportResult, ProfileRecord } from "./profile";
import { CvImportRequestSchema, ProfileSchema } from "./profile";
import type {
  CompanyAddResult,
  CompanyRecord,
  IngestStartResult,
  JobListItem,
  LatestRun,
} from "./ingest";
import {
  CompanyAddRequestSchema,
  IngestCancelRequestSchema,
  IngestStartRequestSchema,
} from "./ingest";
import type { DiscoverySearchResult } from "./discovery";
import { DiscoverySearchRequestSchema } from "./discovery";
import type {
  ApplicationDocuments,
  DocumentExportResult,
  DocumentGenerateResult,
  DocumentSaveResult,
} from "./documents";
import {
  DocumentExportRequestSchema,
  DocumentGenerateRequestSchema,
  DocumentGetRequestSchema,
  DocumentSaveRequestSchema,
} from "./documents";
import type { ScoreStartResult } from "./scoring";
import { ScoreStartRequestSchema } from "./scoring";
import type {
  ApplicationDetail,
  ApplicationExportResult,
  ApplicationStartResult,
  ApplicationSummary,
  ApplicationUpdateResult,
  DuplicateCheck,
} from "./applications";
import {
  ApplicationBookmarkRequestSchema,
  ApplicationCheckRequestSchema,
  ApplicationDetailRequestSchema,
  ApplicationStartRequestSchema,
  ApplicationUpdateRequestSchema,
} from "./applications";
import type { JobDetail, SavedSearch } from "./jobs";
import {
  JobDetailRequestSchema,
  JobFlagRequestSchema,
  JobsListRequestSchema,
  SavedSearchDeleteRequestSchema,
  SavedSearchSaveRequestSchema,
} from "./jobs";

/**
 * Request payload per channel. Main validates every incoming payload with these schemas before
 * it touches the database or the keychain.
 */
export const IPC_REQUEST_SCHEMAS = {
  "settings:get": z.undefined(),
  "settings:update": AppSettingsPatchSchema,
  "secrets:status": z.undefined(),
  "secrets:set": SecretSetRequestSchema,
  "secrets:clear": SecretClearRequestSchema,
  "ai:test-connection": z.undefined(),
  "profile:get": z.undefined(),
  "profile:save": ProfileSchema,
  "profile:import-cv": CvImportRequestSchema,
  "companies:list": z.undefined(),
  "companies:add": CompanyAddRequestSchema,
  "jobs:list": JobsListRequestSchema,
  "jobs:detail": JobDetailRequestSchema,
  "jobs:flag": JobFlagRequestSchema,
  "applications:list": z.undefined(),
  "applications:detail": ApplicationDetailRequestSchema,
  "applications:bookmark": ApplicationBookmarkRequestSchema,
  "applications:check": ApplicationCheckRequestSchema,
  "applications:start": ApplicationStartRequestSchema,
  "applications:update": ApplicationUpdateRequestSchema,
  "applications:export": z.undefined(),
  "saved-searches:list": z.undefined(),
  "saved-searches:save": SavedSearchSaveRequestSchema,
  "saved-searches:delete": SavedSearchDeleteRequestSchema,
  "ingest:start": IngestStartRequestSchema,
  "ingest:cancel": IngestCancelRequestSchema,
  "ingest:latest": z.undefined(),
  "discovery:search": DiscoverySearchRequestSchema,
  "scores:start": ScoreStartRequestSchema,
  "documents:get": DocumentGetRequestSchema,
  "documents:generate": DocumentGenerateRequestSchema,
  "documents:save": DocumentSaveRequestSchema,
  "documents:export": DocumentExportRequestSchema,
  "documents:reveal": DocumentExportRequestSchema,
} as const;

export type IpcChannel = keyof typeof IPC_REQUEST_SCHEMAS;

export type IpcRequest<C extends IpcChannel> = z.input<(typeof IPC_REQUEST_SCHEMAS)[C]>;

export interface IpcResponses {
  "settings:get": AppSettings;
  "settings:update": AppSettings;
  "secrets:status": SecretsStatus;
  "secrets:set": SecretsStatus;
  "secrets:clear": SecretsStatus;
  "ai:test-connection": AiTestResult;
  "profile:get": ProfileRecord | null;
  "profile:save": ProfileRecord;
  "profile:import-cv": CvImportResult;
  "companies:list": CompanyRecord[];
  "companies:add": CompanyAddResult;
  "jobs:list": JobListItem[];
  "jobs:detail": JobDetail | null;
  "jobs:flag": boolean;
  "applications:list": ApplicationSummary[];
  "applications:detail": ApplicationDetail | null;
  "applications:bookmark": boolean;
  "applications:check": DuplicateCheck;
  "applications:start": ApplicationStartResult;
  "applications:update": ApplicationUpdateResult;
  "applications:export": ApplicationExportResult;
  "saved-searches:list": SavedSearch[];
  "saved-searches:save": SavedSearch | null;
  "saved-searches:delete": void;
  "ingest:start": IngestStartResult;
  "ingest:cancel": void;
  "ingest:latest": LatestRun | null;
  "discovery:search": DiscoverySearchResult;
  "scores:start": ScoreStartResult;
  "documents:get": ApplicationDocuments;
  "documents:generate": DocumentGenerateResult;
  "documents:save": DocumentSaveResult;
  "documents:export": DocumentExportResult;
  "documents:reveal": boolean;
}

export type IpcResponse<C extends IpcChannel> = IpcResponses[C];
