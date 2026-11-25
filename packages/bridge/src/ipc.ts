import { z } from "zod";
import type { AppSettings } from "./settings";
import { AppSettingsPatchSchema, SETTING_LIMITS } from "./settings";
import { AI_MODEL_SOURCES, type AiModelsResult, type AiTestResult } from "./ai";
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
  CompanyRemoveRequestSchema,
  IngestCancelRequestSchema,
  IngestStartRequestSchema,
} from "./ingest";
import type { DiscoverySearchResult, ProfileDiscoveryResult } from "./discovery";
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
  DocumentSetLanguageRequestSchema,
} from "./documents";
import type { AppStatus, OpenNewJobsRequest } from "./app";
import type { AutofillStartResult } from "./autofill";
import { AutofillStartRequestSchema } from "./autofill";
import type { ScoreStartResult } from "./scoring";
import { ScoreStartRequestSchema } from "./scoring";
import type {
  ApplicationDetail,
  ApplicationExportResult,
  ApplicationRemoveResult,
  ApplicationStartResult,
  ApplicationSummary,
  ApplicationUpdateResult,
  DuplicateCheck,
} from "./applications";
import {
  ApplicationBookmarkRequestSchema,
  ApplicationCheckRequestSchema,
  ApplicationDetailRequestSchema,
  ApplicationRemoveRequestSchema,
  ApplicationStartRequestSchema,
  ApplicationUpdateRequestSchema,
} from "./applications";
import type { JobDetail } from "./jobs";
import { JobDetailRequestSchema, JobFlagRequestSchema, JobsListRequestSchema } from "./jobs";

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
  /**
   * The model menu: the source and the base URL being edited, not yet saved. Main decides whether
   * the saved key goes with the request; the key never travels in this payload.
   */
  "ai:models": z.strictObject({
    source: z.enum(AI_MODEL_SOURCES),
    baseUrl: z.string().trim().max(SETTING_LIMITS.baseUrlMaxLength),
  }),
  "profile:get": z.undefined(),
  "profile:save": ProfileSchema,
  "profile:import-cv": CvImportRequestSchema,
  "profile:cancel-import": z.undefined(),
  "companies:list": z.undefined(),
  "companies:add": CompanyAddRequestSchema,
  "companies:remove": CompanyRemoveRequestSchema,
  "jobs:list": JobsListRequestSchema,
  "jobs:detail": JobDetailRequestSchema,
  "jobs:flag": JobFlagRequestSchema,
  "applications:list": z.undefined(),
  "applications:detail": ApplicationDetailRequestSchema,
  "applications:bookmark": ApplicationBookmarkRequestSchema,
  "applications:check": ApplicationCheckRequestSchema,
  "applications:start": ApplicationStartRequestSchema,
  "applications:update": ApplicationUpdateRequestSchema,
  "applications:remove": ApplicationRemoveRequestSchema,
  "applications:export": z.undefined(),
  "ingest:start": IngestStartRequestSchema,
  "ingest:cancel": IngestCancelRequestSchema,
  "ingest:latest": z.undefined(),
  "discovery:search": DiscoverySearchRequestSchema,
  "discovery:from-profile": z.undefined(),
  "scores:start": ScoreStartRequestSchema,
  "documents:get": DocumentGetRequestSchema,
  "documents:generate": DocumentGenerateRequestSchema,
  "documents:set-language": DocumentSetLanguageRequestSchema,
  "documents:save": DocumentSaveRequestSchema,
  "documents:export": DocumentExportRequestSchema,
  "documents:reveal": DocumentExportRequestSchema,
  "autofill:start": AutofillStartRequestSchema,
  "app:status": z.undefined(),
  "app:open-update": z.undefined(),
  "app:take-pending-open": z.undefined(),
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
  "ai:models": AiModelsResult;
  "profile:get": ProfileRecord | null;
  "profile:save": ProfileRecord;
  "profile:import-cv": CvImportResult;
  "profile:cancel-import": void;
  "companies:list": CompanyRecord[];
  "companies:add": CompanyAddResult;
  "companies:remove": boolean;
  "jobs:list": JobListItem[];
  "jobs:detail": JobDetail | null;
  "jobs:flag": boolean;
  "applications:list": ApplicationSummary[];
  "applications:detail": ApplicationDetail | null;
  "applications:bookmark": boolean;
  "applications:check": DuplicateCheck;
  "applications:start": ApplicationStartResult;
  "applications:update": ApplicationUpdateResult;
  "applications:remove": ApplicationRemoveResult;
  "applications:export": ApplicationExportResult;
  "ingest:start": IngestStartResult;
  "ingest:cancel": void;
  "ingest:latest": LatestRun | null;
  "discovery:search": DiscoverySearchResult;
  "discovery:from-profile": ProfileDiscoveryResult;
  "scores:start": ScoreStartResult;
  "documents:get": ApplicationDocuments;
  "documents:generate": DocumentGenerateResult;
  "documents:set-language": boolean;
  "documents:save": DocumentSaveResult;
  "documents:export": DocumentExportResult;
  "documents:reveal": boolean;
  "autofill:start": AutofillStartResult;
  "app:status": AppStatus;
  "app:open-update": boolean;
  "app:take-pending-open": OpenNewJobsRequest | null;
}

export type IpcResponse<C extends IpcChannel> = IpcResponses[C];
