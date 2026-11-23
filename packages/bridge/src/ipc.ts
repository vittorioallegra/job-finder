import { z } from "zod";
import type { AppSettings } from "./settings";
import { AppSettingsPatchSchema } from "./settings";
import type { AiTestResult } from "./ai";
import type { SecretsStatus } from "./secrets";
import { SecretClearRequestSchema, SecretSetRequestSchema } from "./secrets";
import type { CvImportResult, ProfileRecord } from "./profile";
import { CvImportRequestSchema, ProfileSchema } from "./profile";

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
}

export type IpcResponse<C extends IpcChannel> = IpcResponses[C];
