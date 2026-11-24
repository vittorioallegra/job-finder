// protects=affinity scores are computed once per job, profile version, model, prompt version and explanation language, reused when all still match, and the explanation is asked for in the requested language, and stop at the run budget, the concurrency limit and the first provider failure while keeping the scores already made;
// fails_when=a stored score is reused after its job, profile version, model or explanation language changed, an explanation is requested in another language, a job is scored past the budget, more calls run at once than the limit, an invalid answer is stored, a failing provider is called again, or a score is stored without a valid cache key;
// no_claim=the answers come from scripted test doubles, so the quality of real model answers and the real provider's behaviour are not shown; the store is in memory, not the SQLite tables;
import { describe, expect, it } from "vitest";
import { createAiModel } from "../ai";
import { emptyProfile, scoringFields } from "../profile/schema";
import { jobContentHash, profileHash, SCORE_PROMPT_VERSION, type ScoringJob } from "./prompt";
import { scoreJobs, type ScoreStore, type ScoringAi, type StoredScore } from "./score";

const MODEL_ID = "local-test";

function job(id: string, description = "Build APIs in TypeScript."): ScoringJob {
  return {
    id,
    companyName: "Acme Robotics",
    title: `Engineer ${id}`,
    description,
    locations: [{ raw: "Milan, Italy" }],
    workMode: "hybrid",
    remoteScope: null,
    employmentType: "full-time",
    seniority: "senior",
    salary: null,
    visaSponsorship: "unknown",
    language: "en",
  };
}

const profile = (() => {
  const base = emptyProfile();
  base.skills = [{ name: "TypeScript", level: "expert", aliases: [] }];
  return scoringFields(base);
})();

function memoryStore(jobs: ScoringJob[], initial: StoredScore[] = []) {
  const rows = [...initial];
  const store: ScoreStore = {
    loadJobs: async (ids) => jobs.filter((item) => ids.includes(item.id)),
    lookup: async (version, ids) =>
      rows.filter((row) => row.profileVersion === version && ids.includes(row.jobId)),
    persist: async (next) => {
      for (const row of next) {
        const at = rows.findIndex(
          (item) => item.jobId === row.jobId && item.profileVersion === row.profileVersion,
        );
        if (at >= 0) rows[at] = row;
        else rows.push(row);
      }
    },
  };
  return { store, rows };
}

function chatCompletion(content: string): Response {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 0,
      model: MODEL_ID,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/**
 * A scripted model. `reply` gets the call number (from 0) and answers with a JSON text, or with an
 * HTTP status. `tracker` records the peak number of calls in flight.
 */
function scriptedAi(
  reply: (call: number) => string | number,
  options: { delayMs?: number; contextSize?: number } = {},
) {
  let calls = 0;
  let inFlight = 0;
  let peak = 0;
  const bodies: string[] = [];
  const fetchImpl = (async (_input: unknown, init?: { body?: unknown }) => {
    const call = calls;
    calls += 1;
    bodies.push(String(init?.body ?? ""));
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 0));
    inFlight -= 1;
    const answer = reply(call);
    if (typeof answer === "number") return new Response("{}", { status: answer });
    return chatCompletion(answer);
  }) as typeof fetch;
  const handle = createAiModel(
    {
      provider: "openai-compatible",
      model: MODEL_ID,
      baseUrl: "http://localhost:1234/v1",
      apiKey: null,
    },
    { fetch: fetchImpl },
  );
  const ai: ScoringAi = {
    model: handle.model,
    capabilities: handle.capabilities,
    modelId: MODEL_ID,
    contextSize: options.contextSize ?? 8192,
  };
  return {
    ai,
    calls: () => calls,
    peak: () => peak,
    bodies,
  };
}

const answer = (score: number, explanation = "Strong TypeScript match.") =>
  JSON.stringify({ score, explanation });

describe("scoreJobs", () => {
  it("scores each job once, stores its score under the cache key, and makes no AI call when the stored score still applies", async () => {
    const jobs = [job("a"), job("b")];
    const { store, rows } = memoryStore(jobs);
    const first = scriptedAi((call) => answer(80 + call));

    const run = await scoreJobs({
      store,
      ai: first.ai,
      profile,
      profileVersion: 1,
      jobIds: ["a", "b"],
      language: "en",
    });

    expect(run).toMatchObject({ ok: true, scored: 2, cached: 0, failed: 0, skipped: 0 });
    expect(first.calls()).toBe(2);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.jobId === "a")).toMatchObject({
      profileVersion: 1,
      jobHash: jobContentHash(jobs[0]!),
      profileHash: profileHash(profile),
      model: MODEL_ID,
      promptVersion: SCORE_PROMPT_VERSION,
      explanationLanguage: "en",
      explanation: "Strong TypeScript match.",
    });

    const second = scriptedAi(() => answer(10));
    const again = await scoreJobs({
      store,
      ai: second.ai,
      profile,
      profileVersion: 1,
      jobIds: ["a", "b"],
      language: "en",
    });

    expect(again).toMatchObject({ ok: true, scored: 0, cached: 2 });
    expect(second.calls()).toBe(0);
  });

  it("scores again when the job content, the profile version or the model changed", async () => {
    const changed = job("a", "Build APIs in Go.");
    const initial: StoredScore = {
      jobId: "a",
      profileVersion: 1,
      jobHash: jobContentHash(job("a")),
      profileHash: profileHash(profile),
      model: MODEL_ID,
      promptVersion: SCORE_PROMPT_VERSION,
      explanationLanguage: "en",
      score: 90,
      explanation: "Old.",
      createdAt: 0,
    };

    const jobChanged = memoryStore([changed], [initial]);
    const ai1 = scriptedAi(() => answer(40));
    expect(
      await scoreJobs({
        store: jobChanged.store,
        ai: ai1.ai,
        profile,
        profileVersion: 1,
        jobIds: ["a"],
        language: "en",
      }),
    ).toMatchObject({ scored: 1, cached: 0 });

    const newVersion = memoryStore([job("a")], [initial]);
    const ai2 = scriptedAi(() => answer(40));
    expect(
      await scoreJobs({
        store: newVersion.store,
        ai: ai2.ai,
        profile,
        profileVersion: 2,
        jobIds: ["a"],
        language: "en",
      }),
    ).toMatchObject({ scored: 1, cached: 0 });

    const otherModel = memoryStore([job("a")], [initial]);
    const ai3 = scriptedAi(() => answer(40));
    const modelChanged = { ...ai3.ai, modelId: "another-model" };
    expect(
      await scoreJobs({
        store: otherModel.store,
        ai: modelChanged,
        profile,
        profileVersion: 1,
        jobIds: ["a"],
        language: "en",
      }),
    ).toMatchObject({ scored: 1, cached: 0 });
  });

  it("stops at the run budget and counts the jobs past it as skipped", async () => {
    const jobs = [job("a"), job("b"), job("c")];
    const { store, rows } = memoryStore(jobs);
    const ai = scriptedAi(() => answer(70));

    const run = await scoreJobs({
      store,
      ai: ai.ai,
      profile,
      profileVersion: 1,
      jobIds: ["a", "b", "c"],
      language: "en",
      budget: 2,
      concurrency: 1,
    });

    expect(run).toMatchObject({ ok: true, scored: 2, skipped: 1 });
    expect(ai.calls()).toBe(2);
    expect(rows.map((row) => row.jobId).sort()).toEqual(["a", "b"]);
  });

  it("never runs more AI calls at once than the concurrency limit", async () => {
    const jobs = ["a", "b", "c", "d", "e", "f"].map((id) => job(id));
    const { store } = memoryStore(jobs);
    const ai = scriptedAi(() => answer(60), { delayMs: 5 });

    const run = await scoreJobs({
      store,
      ai: ai.ai,
      profile,
      profileVersion: 1,
      jobIds: jobs.map((item) => item.id),
      language: "en",
      concurrency: 2,
    });

    expect(run).toMatchObject({ ok: true, scored: 6 });
    expect(ai.peak()).toBeLessThanOrEqual(2);
  });

  it("counts a job whose answer stays invalid after the repair retry as failed and stores nothing for it", async () => {
    const jobs = [job("a"), job("b")];
    const { store, rows } = memoryStore(jobs);
    const ai = scriptedAi((call) => (call < 2 ? "not json at all" : answer(75)));

    const run = await scoreJobs({
      store,
      ai: ai.ai,
      profile,
      profileVersion: 1,
      jobIds: ["a", "b"],
      language: "en",
      concurrency: 1,
    });

    expect(run).toMatchObject({ ok: true, scored: 1, failed: 1 });
    expect(rows.map((row) => row.jobId)).toEqual(["b"]);
  });

  it("stops at the first provider failure, keeps the scores already made and reports the AI unavailable", async () => {
    const jobs = [job("a"), job("b"), job("c")];
    const { store, rows } = memoryStore(jobs);
    const ai = scriptedAi((call) => (call === 0 ? answer(81) : 401));

    const run = await scoreJobs({
      store,
      ai: ai.ai,
      profile,
      profileVersion: 1,
      jobIds: ["a", "b", "c"],
      language: "en",
      concurrency: 1,
    });

    expect(run).toEqual({ ok: false, code: "ai-unavailable" });
    expect(rows.map((row) => row.jobId)).toEqual(["a"]);
    expect(ai.calls()).toBe(2);
  });

  it("fails a job whose prompt does not fit the context without calling the model, and skips ids the store does not know", async () => {
    const { store } = memoryStore([job("a")]);
    const ai = scriptedAi(() => answer(50), { contextSize: 300 });

    const run = await scoreJobs({
      store,
      ai: ai.ai,
      profile,
      profileVersion: 1,
      jobIds: ["a", "missing"],
      language: "en",
    });

    expect(run).toMatchObject({ ok: true, scored: 0, failed: 1, skipped: 1 });
    expect(ai.calls()).toBe(0);
  });

  it("asks for the explanation in the requested language and recomputes a stored score written in another language", async () => {
    const jobs = [job("a")];
    const english: StoredScore = {
      jobId: "a",
      profileVersion: 1,
      jobHash: jobContentHash(jobs[0]!),
      profileHash: profileHash(profile),
      model: MODEL_ID,
      promptVersion: SCORE_PROMPT_VERSION,
      explanationLanguage: "en",
      score: 70,
      explanation: "Strong TypeScript match.",
      createdAt: 0,
    };
    const { store, rows } = memoryStore(jobs, [english]);
    const italian = scriptedAi(() => answer(70, "Buona corrispondenza con TypeScript."));

    const run = await scoreJobs({
      store,
      ai: italian.ai,
      profile,
      profileVersion: 1,
      jobIds: ["a"],
      language: "it",
    });

    expect(run).toMatchObject({ ok: true, scored: 1, cached: 0 });
    expect(italian.bodies[0]).toContain("in Italian");
    expect(rows.find((row) => row.jobId === "a")).toMatchObject({
      explanationLanguage: "it",
      explanation: "Buona corrispondenza con TypeScript.",
    });

    const again = scriptedAi(() => answer(10));
    const cached = await scoreJobs({
      store,
      ai: again.ai,
      profile,
      profileVersion: 1,
      jobIds: ["a"],
      language: "it",
    });

    expect(cached).toMatchObject({ ok: true, scored: 0, cached: 1 });
    expect(again.calls()).toBe(0);
  });
});
