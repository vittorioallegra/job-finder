import { createAiModel, type AiModelHandle, type AiProviderConfig } from "@job-finder/core/ai";
import {
  scoreJobs,
  type ScoringJob,
  type ScoreStore,
  type StoredScore,
} from "@job-finder/core/ranking";
import type { DbCall, DbResult, ScoreJobsOutcome, ScoreJobsRequest } from "./protocol";

/** Scores one request. The database is reached only through the batched calls of `db`. */
export interface ScoringRunner {
  score(request: ScoreJobsRequest): Promise<ScoreJobsOutcome>;
}

export interface ScoringRunnerOptions {
  /** Builds the model for a configuration. Tests pass a model that replays scripted answers. */
  createModel?: (config: AiProviderConfig) => AiModelHandle;
}

/** The scoring store over main's batched database calls. A failed call throws. */
export function createDbScoreStore(db: (calls: DbCall[]) => Promise<DbResult[]>): ScoreStore {
  const one = async (call: DbCall): Promise<unknown> => {
    const [result] = await db([call]);
    if (!result) throw new Error("database returned no result");
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };

  return {
    async loadJobs(jobIds) {
      return (await one({ name: "scores.jobs", jobIds })) as ScoringJob[];
    },
    async lookup(profileVersion, jobIds) {
      return (await one({ name: "scores.lookup", profileVersion, jobIds })) as StoredScore[];
    },
    async persist(rows) {
      await one({ name: "scores.persist", rows });
    },
  };
}

/** Builds the runner over the runtime's database calls. A model that cannot be built means the AI is unavailable. */
export function createScoringRunner(
  db: (calls: DbCall[]) => Promise<DbResult[]>,
  options: ScoringRunnerOptions = {},
): ScoringRunner {
  const createModel = options.createModel ?? ((config) => createAiModel(config));
  return {
    async score(request) {
      let handle: AiModelHandle;
      try {
        handle = createModel({ ...request.ai.config, contextSize: request.ai.contextSize });
      } catch {
        return { ok: false, code: "ai-unavailable" };
      }
      return scoreJobs({
        store: createDbScoreStore(db),
        ai: {
          model: handle.model,
          capabilities: handle.capabilities,
          modelId: request.ai.config.model.trim(),
          contextSize: request.ai.contextSize,
        },
        profile: request.profile,
        profileVersion: request.profileVersion,
        jobIds: request.jobIds,
        language: request.language,
      });
    },
  };
}
