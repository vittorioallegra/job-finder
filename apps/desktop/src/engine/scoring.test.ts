// protects=the engine scores a request only through batched database calls, stores each score for its job and profile version, reports the AI as unavailable without any call when no model can be built, and lets a failed database call reject the run so main can report a store failure;
// fails_when=a score is computed without reading its jobs, a score is stored for another job or profile version, a model is built and called after its configuration failed, or a failed database call is reported as a score;
// no_claim=the answers come from a scripted model, not a provider, and the SQL behind the calls is covered by the desktop database tests;
import { describe, expect, it } from "vitest";
import { AiError, createAiModel, type AiProviderConfig } from "@job-finder/core/ai";
import { emptyProfile, scoringFields } from "@job-finder/core/profile";
import type { ScoringJob, StoredScore } from "@job-finder/core/ranking";
import type { DbCall, DbResult, ScoreJobsRequest } from "./protocol";
import { createScoringRunner } from "./scoring";

const config: AiProviderConfig = {
  provider: "openai-compatible",
  model: "local-test",
  baseUrl: "http://localhost:11434/v1",
  apiKey: null,
};

const job: ScoringJob = {
  id: "j1",
  companyName: "Acme",
  title: "Backend Engineer",
  description: "Build APIs in TypeScript.",
  locations: [{ raw: "Milan, Italy" }],
  workMode: "hybrid",
  remoteScope: null,
  employmentType: "full-time",
  seniority: "senior",
  salary: null,
  visaSponsorship: "unknown",
  language: "en",
};

function request(jobIds: string[] = ["j1"]): ScoreJobsRequest {
  return {
    profile: scoringFields(emptyProfile()),
    profileVersion: 3,
    jobIds,
    ai: { config, contextSize: 8192 },
  };
}

/** A model whose every answer is the same valid score. */
function scriptedModel(score: number) {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 0,
        model: "local-test",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({ score, explanation: "Good match." }),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
  return (cfg: AiProviderConfig) => createAiModel(cfg, { fetch: fetchImpl });
}

/** A database that records every call and answers the scoring calls from memory. */
function fakeDb(failing?: DbCall["name"]) {
  const calls: DbCall[] = [];
  const persisted: StoredScore[] = [];
  const db = async (batch: DbCall[]): Promise<DbResult[]> =>
    batch.map((call) => {
      calls.push(call);
      if (call.name === failing) return { ok: false, error: "disk full" };
      if (call.name === "scores.jobs") return { ok: true, value: [job] };
      if (call.name === "scores.lookup") return { ok: true, value: [] };
      if (call.name === "scores.persist") {
        persisted.push(...call.rows);
        return { ok: true, value: null };
      }
      return { ok: true, value: null };
    });
  return { db, calls, persisted };
}

describe("scoring runner", () => {
  it("reads the jobs and the stored scores through batched calls, and stores each score for its job and profile version", async () => {
    const { db, calls, persisted } = fakeDb();
    const runner = createScoringRunner(db, { createModel: scriptedModel(77) });

    const outcome = await runner.score(request());

    expect(outcome).toMatchObject({ ok: true, scored: 1, cached: 0, failed: 0, skipped: 0 });
    expect(calls.map((call) => call.name)).toEqual([
      "scores.jobs",
      "scores.lookup",
      "scores.persist",
    ]);
    expect(persisted).toEqual([
      expect.objectContaining({ jobId: "j1", profileVersion: 3, score: 77, model: "local-test" }),
    ]);
  });

  it("reports the AI as unavailable, with no database call, when the model cannot be built", async () => {
    const { db, calls } = fakeDb();
    const runner = createScoringRunner(db, {
      createModel: () => {
        throw new AiError("not-configured", "No API key is set for the AI provider");
      },
    });

    expect(await runner.score(request())).toEqual({ ok: false, code: "ai-unavailable" });
    expect(calls).toEqual([]);
  });

  it("rejects the run when a database call fails, so main can report a store failure", async () => {
    const { db } = fakeDb("scores.jobs");
    const runner = createScoringRunner(db, { createModel: scriptedModel(50) });

    await expect(runner.score(request())).rejects.toThrow("disk full");
  });
});
