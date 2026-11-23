import {
  IPC_REQUEST_SCHEMAS,
  type AppSettingsPatch,
  type CvImportRequest,
  type IpcChannel,
  type SecretName,
} from "@job-finder/bridge";
import type { Profile } from "@job-finder/core/profile";
import type { AiConnectionService } from "../ai/connection";
import type { CvImportService } from "../profile/cv-import";
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
