import { hasStoredAiConsent } from "@job-finder/bridge";
import type { IngestRunOutcome } from "@job-finder/core/ingest/events";
import type { SettingsRepository } from "../settings/repository";
import type { ScoringService } from "./service";

export interface AutoScoringOptions {
  settings: Pick<SettingsRepository, "get">;
  scoring: Pick<ScoringService, "start">;
  /** Jobs the scan of this run found that were not stored before. */
  newJobsOf(runId: string): Promise<number>;
  log(level: "info" | "warn", message: string): void;
}

export interface AutoScoring {
  /**
   * A scan ended. When it succeeded and found new jobs, the AI is on and the user already agreed to
   * send the profile to this provider (or it runs on this computer), the open jobs are scored by
   * affinity, so the new ones are ranked when the user opens the list. Scores already stored are
   * reused, so only the jobs without one are sent to the AI.
   */
  handleRunFinished(runId: string, status: IngestRunOutcome | "interrupted"): Promise<void>;
}

/** Scores the jobs a scan found, by itself, when the AI is on. */
export function createAutoScoring(options: AutoScoringOptions): AutoScoring {
  return {
    async handleRunFinished(runId, status) {
      if (status !== "succeeded") return;
      try {
        const { ai } = await options.settings.get();
        if (!hasStoredAiConsent(ai)) return;
        if ((await options.newJobsOf(runId)) === 0) return;
        const result = await options.scoring.start({
          consent: true,
          consentTarget: ai.consentTarget,
        });
        options.log(
          result.ok ? "info" : "warn",
          result.ok
            ? `scored the jobs of the scan: ${result.scored} new, ${result.cached} already scored`
            : `could not score the jobs of the scan: ${result.code}`,
        );
      } catch (error) {
        options.log("warn", `could not score the jobs of the scan: ${String(error)}`);
      }
    },
  };
}
