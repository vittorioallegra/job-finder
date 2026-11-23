import PQueue from "p-queue";
import type { LanguageModel } from "ai";
import { AiError, checkContextFit, generateStructured, type AiCapabilities } from "../ai";
import type { ScoringFields } from "../profile/schema";
import {
  jobContentHash,
  profileHash,
  scorePrompt,
  ScoreSchema,
  SCORE_PROMPT_VERSION,
  type ScoringJob,
} from "./prompt";

/** A stored score. `jobHash`, `profileHash`, `model` and `promptVersion` are its cache key. */
export interface StoredScore {
  jobId: string;
  profileVersion: number;
  jobHash: string;
  profileHash: string;
  model: string;
  promptVersion: number;
  score: number;
  explanation: string;
  createdAt: number;
}

/**
 * What scoring needs from storage. The engine implements it with batched database calls through
 * main; tests implement it in memory. Jobs unknown to the store are reported as skipped.
 */
export interface ScoreStore {
  loadJobs(jobIds: string[]): Promise<ScoringJob[]>;
  /** The stored scores of these jobs for one profile version. */
  lookup(profileVersion: number, jobIds: string[]): Promise<StoredScore[]>;
  persist(rows: StoredScore[]): Promise<void>;
}

/** The AI model for one run. `modelId` is the configured model name, part of the cache key. */
export interface ScoringAi {
  model: LanguageModel;
  capabilities: AiCapabilities;
  modelId: string;
  /** Configured context size of the model, in tokens. */
  contextSize: number;
}

/** Most AI calls one run may make, cached scores excluded. Jobs past the budget stay unscored until the next run. */
export const SCORING_AI_BUDGET = 50;
/** Concurrent AI calls in one run. */
export const SCORING_CONCURRENCY = 3;
/** Jobs read from storage and checked against the cache per step. */
const CHUNK_SIZE = 10;

export interface ScoreJobsOptions {
  store: ScoreStore;
  ai: ScoringAi;
  profile: ScoringFields;
  profileVersion: number;
  /** In the order to score them: visible and top jobs first. Duplicates are scored once. */
  jobIds: string[];
  now?: () => number;
  budget?: number;
  concurrency?: number;
}

export interface ScoreCounts {
  /** Scores computed and stored in this run. */
  scored: number;
  /** Jobs whose stored score still applied, so no AI call was made. */
  cached: number;
  /** Jobs whose answer was invalid after the repair retry, or whose prompt did not fit the context. */
  failed: number;
  /** Jobs not scored: past the AI budget, or not found in storage. */
  skipped: number;
}

export type ScoreOutcome = ({ ok: true } & ScoreCounts) | { ok: false; code: "ai-unavailable" };

/**
 * Scores the jobs with the AI. A stored score is reused when its job content, profile, model and
 * prompt version all match; otherwise one AI call is made, within the run budget and the concurrency
 * limit. A provider failure other than an invalid answer (unreachable, rejected key, rate limit,
 * unknown model) stops the run: no further calls are made and the outcome says the AI is unavailable.
 * Scores computed before the failure are kept.
 */
export async function scoreJobs(options: ScoreJobsOptions): Promise<ScoreOutcome> {
  const { store, ai, profile, profileVersion } = options;
  const now = options.now ?? (() => Date.now());
  const queue = new PQueue({ concurrency: options.concurrency ?? SCORING_CONCURRENCY });
  const currentProfileHash = profileHash(profile);
  const ids = [...new Set(options.jobIds)];
  const counts: ScoreCounts = { scored: 0, cached: 0, failed: 0, skipped: 0 };
  let remaining = options.budget ?? SCORING_AI_BUDGET;
  let unavailable = false;

  for (let start = 0; start < ids.length; start += CHUNK_SIZE) {
    const chunk = ids.slice(start, start + CHUNK_SIZE);
    const jobs = await store.loadJobs(chunk);
    const byId = new Map(jobs.map((job) => [job.id, job]));
    counts.skipped += chunk.filter((id) => !byId.has(id)).length;

    const stored = new Map(
      (await store.lookup(profileVersion, chunk)).map((row) => [row.jobId, row]),
    );
    const misses: Array<{ job: ScoringJob; jobHash: string }> = [];
    for (const id of chunk) {
      const job = byId.get(id);
      if (!job) continue;
      const jobHash = jobContentHash(job);
      const row = stored.get(id);
      if (
        row &&
        row.jobHash === jobHash &&
        row.profileHash === currentProfileHash &&
        row.model === ai.modelId &&
        row.promptVersion === SCORE_PROMPT_VERSION
      ) {
        counts.cached += 1;
      } else {
        misses.push({ job, jobHash });
      }
    }

    const rows: StoredScore[] = [];
    await Promise.all(
      misses.map(({ job, jobHash }) =>
        queue.add(async () => {
          if (unavailable) return;
          if (remaining <= 0) {
            counts.skipped += 1;
            return;
          }
          remaining -= 1;
          const prompt = scorePrompt(job, profile);
          if (checkContextFit(`${prompt.system}\n${prompt.user}`, ai.contextSize).exceeds) {
            counts.failed += 1;
            return;
          }
          try {
            const result = await generateStructured({
              model: ai.model,
              capabilities: ai.capabilities,
              schema: ScoreSchema,
              system: prompt.system,
              prompt: prompt.user,
              contextSize: ai.contextSize,
            });
            rows.push({
              jobId: job.id,
              profileVersion,
              jobHash,
              profileHash: currentProfileHash,
              model: ai.modelId,
              promptVersion: SCORE_PROMPT_VERSION,
              score: result.value.score,
              explanation: result.value.explanation,
              createdAt: now(),
            });
            counts.scored += 1;
          } catch (error) {
            if (error instanceof AiError && error.code === "invalid-output") {
              counts.failed += 1;
            } else {
              unavailable = true;
            }
          }
        }),
      ),
    );

    if (rows.length > 0) {
      await store.persist(rows);
    }
    if (unavailable) {
      return { ok: false, code: "ai-unavailable" };
    }
  }

  return { ok: true, ...counts };
}
