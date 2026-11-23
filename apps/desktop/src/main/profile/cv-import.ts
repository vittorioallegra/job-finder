import { hasAiConsent, type CvImportRequest, type CvImportResult } from "@job-finder/bridge";
import type {
  CvImportOutcome,
  CvImportRequest as EngineCvImportRequest,
} from "@job-finder/core/cv";
import { EngineUnavailableError } from "../engine/supervisor";
import type { SecretStore } from "../secrets/store";
import type { SettingsRepository } from "../settings/repository";

/** The engine side of a CV import, as seen from main. */
export interface CvEngine {
  importCv(request: EngineCvImportRequest): Promise<CvImportOutcome>;
}

export interface CvImportService {
  /** Extracts a profile draft. Nothing is saved here; the renderer shows the draft for review. */
  importCv(request: CvImportRequest): Promise<CvImportResult>;
}

export interface CvImportServiceOptions {
  settings: SettingsRepository;
  secrets: SecretStore;
  engine: CvEngine;
}

/**
 * Main-process side of a CV import. A cloud provider needs the user's consent before the CV text
 * leaves the machine; main enforces that even though the renderer also asks. The key is read here
 * and handed only to the engine.
 */
export function createCvImportService(options: CvImportServiceOptions): CvImportService {
  return {
    async importCv(request) {
      const { ai } = await options.settings.get();
      if (!hasAiConsent(ai, request)) {
        return { ok: false, code: "consent-required" };
      }
      const apiKey = await options.secrets.read("ai.apiKey");
      try {
        return await options.engine.importCv({
          config: {
            provider: ai.provider,
            model: ai.model,
            baseUrl: ai.baseUrl,
            apiKey,
          },
          contextSize: ai.contextSize,
          fileName: request.fileName,
          bytes: request.bytes,
        });
      } catch (error) {
        if (error instanceof EngineUnavailableError) {
          return { ok: false, code: "engine-unavailable" };
        }
        return { ok: false, code: "unknown" };
      }
    },
  };
}
