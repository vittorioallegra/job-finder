import {
  isCloudAiEndpoint,
  type ScoreStartRequest,
  type ScoreStartResult,
} from "@job-finder/bridge";
import { scoringFields } from "@job-finder/core/profile";
import type { ExplanationLanguage } from "@job-finder/core/ranking";
import type { ScoreJobsOutcome, ScoreJobsRequest } from "../../engine/protocol";
import { resolveMainLanguage } from "../i18n";
import { EngineUnavailableError } from "../engine/supervisor";
import type { ProfileRepository } from "../profile/repository";
import type { SecretStore } from "../secrets/store";
import type { SettingsRepository } from "../settings/repository";

/** Open jobs scored per run, newest first. Cached scores do not count against the AI budget in the engine. */
export const MAX_SCORED_JOBS = 500;

/** The engine side of a scoring run, as seen from main. */
export interface ScoringEngine {
  scoreJobs(request: ScoreJobsRequest): Promise<ScoreJobsOutcome>;
}

export interface ScoringService {
  /** Scores the open jobs on the current profile version. Resolves when the run has ended. */
  start(request: ScoreStartRequest): Promise<ScoreStartResult>;
}

export interface ScoringServiceOptions {
  engine: ScoringEngine;
  profile: Pick<ProfileRepository, "get">;
  settings: Pick<SettingsRepository, "get">;
  secrets: Pick<SecretStore, "read">;
  /** Open job ids, newest first, at most `limit`. */
  openJobIds(limit: number): Promise<string[]>;
  /** The OS locale, used when the UI language setting is "system". */
  systemLocale(): string;
}

/** The explanation language: the UI language setting, or the OS locale when the setting follows the system. */
export function explanationLanguage(
  setting: "system" | ExplanationLanguage,
  systemLocale: string,
): ExplanationLanguage {
  return setting === "system" ? resolveMainLanguage(systemLocale) : setting;
}

/**
 * Main-process side of a scoring run. Main checks the profile and the consent for a cloud provider
 * (the profile's ranking fields leave the machine), reads the AI settings and the key, and hands the
 * run to the engine. One run at a time.
 */
export function createScoringService(options: ScoringServiceOptions): ScoringService {
  let running = false;

  async function run(request: ScoreStartRequest): Promise<ScoreStartResult> {
    const saved = await options.profile.get();
    if (saved === null) {
      return { ok: false, code: "no-profile" };
    }
    const { ai, ui } = await options.settings.get();
    if (isCloudAiEndpoint(ai) && !request.consent) {
      return { ok: false, code: "consent-required" };
    }
    const jobIds = await options.openJobIds(MAX_SCORED_JOBS);
    if (jobIds.length === 0) {
      return { ok: true, scored: 0, cached: 0, failed: 0, skipped: 0 };
    }
    const apiKey = await options.secrets.read("ai.apiKey");
    const outcome = await options.engine.scoreJobs({
      profile: scoringFields(saved.profile),
      profileVersion: saved.version,
      jobIds,
      language: explanationLanguage(ui.language, options.systemLocale()),
      ai: {
        config: {
          provider: ai.provider,
          model: ai.model,
          baseUrl: ai.baseUrl,
          apiKey,
        },
        contextSize: ai.contextSize,
      },
    });
    if (!outcome.ok) {
      return { ok: false, code: outcome.code };
    }
    return {
      ok: true,
      scored: outcome.scored,
      cached: outcome.cached,
      failed: outcome.failed,
      skipped: outcome.skipped,
    };
  }

  return {
    async start(request) {
      if (running) {
        return { ok: false, code: "already-running" };
      }
      running = true;
      try {
        return await run(request);
      } catch (error) {
        if (error instanceof EngineUnavailableError) {
          return { ok: false, code: "engine-unavailable" };
        }
        return { ok: false, code: "store-failed" };
      } finally {
        running = false;
      }
    },
  };
}
