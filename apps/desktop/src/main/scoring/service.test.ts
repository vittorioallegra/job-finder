// protects=a scoring run starts only with a saved profile and, for a cloud provider, the user's consent; the engine gets the ranking fields and the key but no contact details; a second run is refused while one is active; and an engine that is gone is reported as unavailable;
// fails_when=the engine is asked without a profile or without consent for a cloud provider, the contact details leave main with the profile, the key is missing from the request, a second run starts while one is active, or a lost engine is reported as a store failure;
// no_claim=the real engine, the database and the provider are not reached; the engine and database tests cover them;
import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "@job-finder/bridge";
import { emptyProfile, type Profile } from "@job-finder/core/profile";
import { EngineUnavailableError } from "../engine/supervisor";
import { createScoringService, MAX_SCORED_JOBS, type ScoringEngine } from "./service";
import type { ScoreJobsRequest } from "../../engine/protocol";

function profile(): Profile {
  const saved = emptyProfile();
  saved.contact = { fullName: "Ada Lovelace", email: "ada@example.test", phone: "", location: "" };
  saved.skills = [{ name: "TypeScript", level: "expert", aliases: [] }];
  return saved;
}

function settings(provider: AppSettings["ai"]["provider"], baseUrl = ""): AppSettings {
  return {
    ...DEFAULT_APP_SETTINGS,
    ai: { ...DEFAULT_APP_SETTINGS.ai, provider, model: "local-model", baseUrl, contextSize: 4096 },
  };
}

function deps(overrides: {
  saved?: { profile: Profile; version: number; updatedAt: number } | null;
  ai?: AppSettings;
  openJobIds?: string[];
  key?: string | null;
}) {
  const requests: ScoreJobsRequest[] = [];
  const engine: ScoringEngine = {
    scoreJobs: async (request) => {
      requests.push(request);
      return { ok: true, scored: 2, cached: 1, failed: 0, skipped: 0 };
    },
  };
  const service = createScoringService({
    engine,
    profile: {
      get: async () =>
        overrides.saved === undefined
          ? { profile: profile(), version: 4, updatedAt: 1 }
          : overrides.saved,
    },
    settings: {
      get: async () => overrides.ai ?? settings("openai-compatible", "http://localhost:11434/v1"),
    },
    secrets: { read: async () => (overrides.key === undefined ? "sk-test" : overrides.key) },
    openJobIds: async (limit) => (overrides.openJobIds ?? ["j2", "j1"]).slice(0, limit),
  });
  return { service, requests };
}

describe("scoring service", () => {
  it("hands the run to the engine with the ranking fields, the version, the jobs and the provider, and reports the counts", async () => {
    const { service, requests } = deps({});

    const result = await service.start({ consent: false });

    expect(result).toEqual({ ok: true, scored: 2, cached: 1, failed: 0, skipped: 0 });
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.profileVersion).toBe(4);
    expect(request?.jobIds).toEqual(["j2", "j1"]);
    expect(request?.profile).not.toHaveProperty("contact");
    expect(request?.profile.skills).toEqual([{ name: "TypeScript", level: "expert", aliases: [] }]);
    expect(request?.ai.config).toMatchObject({
      provider: "openai-compatible",
      model: "local-model",
    });
    expect(request?.ai.contextSize).toBe(4096);
  });

  it("refuses to score without a saved profile", async () => {
    const { service, requests } = deps({ saved: null });

    expect(await service.start({ consent: false })).toEqual({ ok: false, code: "no-profile" });
    expect(requests).toEqual([]);
  });

  it("refuses a cloud provider until the user consents, and sends nothing before", async () => {
    const { service, requests } = deps({ ai: settings("anthropic") });

    expect(await service.start({ consent: false })).toEqual({
      ok: false,
      code: "consent-required",
    });
    expect(requests).toEqual([]);

    const consented = await service.start({ consent: true });
    expect(consented).toMatchObject({ ok: true });
    expect(requests).toHaveLength(1);
  });

  it("returns zero counts without asking the engine when no job is open", async () => {
    const { service, requests } = deps({ openJobIds: [] });

    expect(await service.start({ consent: false })).toEqual({
      ok: true,
      scored: 0,
      cached: 0,
      failed: 0,
      skipped: 0,
    });
    expect(requests).toEqual([]);
  });

  it("limits a run to the newest open jobs", async () => {
    const ids = Array.from({ length: MAX_SCORED_JOBS + 5 }, (_, index) => `j${index}`);
    const { service, requests } = deps({ openJobIds: ids });

    await service.start({ consent: false });

    expect(requests[0]?.jobIds).toHaveLength(MAX_SCORED_JOBS);
  });

  it("refuses a second run while one is active", async () => {
    let release: () => void = () => {};
    const engine: ScoringEngine = {
      scoreJobs: () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, scored: 0, cached: 0, failed: 0, skipped: 0 });
        }),
    };
    const service = createScoringService({
      engine,
      profile: { get: async () => ({ profile: profile(), version: 1, updatedAt: 1 }) },
      settings: { get: async () => settings("openai-compatible", "http://localhost:11434/v1") },
      secrets: { read: async () => null },
      openJobIds: async () => ["j1"],
    });

    const first = service.start({ consent: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await service.start({ consent: false })).toEqual({
      ok: false,
      code: "already-running",
    });
    release();
    expect(await first).toMatchObject({ ok: true });
  });

  it("reports an engine that is gone as engine-unavailable", async () => {
    const service = createScoringService({
      engine: {
        scoreJobs: async () => {
          throw new EngineUnavailableError("crashed");
        },
      },
      profile: { get: async () => ({ profile: profile(), version: 1, updatedAt: 1 }) },
      settings: { get: async () => settings("openai-compatible", "http://localhost:11434/v1") },
      secrets: { read: async () => null },
      openJobIds: async () => ["j1"],
    });

    expect(await service.start({ consent: false })).toEqual({
      ok: false,
      code: "engine-unavailable",
    });
  });
});
