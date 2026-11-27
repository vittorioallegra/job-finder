import {
  aiConsentTarget,
  hasAiConsent,
  isCloudAiEndpoint,
  type CvImportRequest,
  type CvImportResult,
} from "@job-finder/bridge";
import type {
  CvImportOutcome,
  CvImportRequest as EngineCvImportRequest,
} from "@job-finder/core/cv";
import { EngineUnavailableError } from "../engine/supervisor";
import type { SecretStore } from "../secrets/store";
import type { SettingsRepository } from "../settings/repository";
import { readAiKey } from "../ai/keys";

/** The engine side of a CV import, as seen from main. */
export interface CvEngine {
  importCv(request: EngineCvImportRequest): Promise<CvImportOutcome>;
  /** Stops the running imports; each then answers `cancelled`. */
  cancelCvImports(): void;
}

export interface CvImportService {
  /** Extracts a profile draft. Nothing is saved here; the renderer shows the draft for review. */
  importCv(request: CvImportRequest): Promise<CvImportResult>;
  /** Stops a running import, so a model on this computer does not keep working for nothing. */
  cancelImport(): void;
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
      if (!ai.enabled) return { ok: false, code: "not-configured" };
      if (!hasAiConsent(ai, request)) {
        return { ok: false, code: "consent-required" };
      }
      // The consent given here is kept, so a later scan can score its new jobs without asking again.
      if (isCloudAiEndpoint(ai) && ai.consentTarget !== aiConsentTarget(ai)) {
        await options.settings.update({ ai: { consentTarget: aiConsentTarget(ai) } });
      }
      const apiKey = await readAiKey(options.secrets, ai);
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
    cancelImport() {
      options.engine.cancelCvImports();
    },
  };
}
