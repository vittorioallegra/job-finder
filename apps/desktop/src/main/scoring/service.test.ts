// protects=a scoring run starts only with a saved profile and, for a cloud provider, the user's consent; its candidates pass the hard filters with the visible jobs first; the explanations are asked for in the UI language (the system locale when the setting follows the system); the engine gets the ranking fields and the key but no contact details; a second run is refused while one is active; and an engine that is gone is reported as unavailable;
// fails_when=the run scores jobs outside the hard filters, the minimum score or the new-only view narrows the run, the visible jobs are not first, the explanations are asked in another language than the UI setting, the engine is asked without a profile or without consent for a cloud provider, the contact details leave main with the profile, the key is missing from the request, a second run starts while one is active, or a lost engine is reported as a store failure;
// no_claim=the real engine, the database and the provider are not reached; the engine and database tests cover them;
import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "@job-finder/bridge";
import { emptyProfile, type Profile } from "@job-finder/core/profile";
import { EngineUnavailableError } from "../engine/supervisor";
import type { JobFilter } from "@job-finder/core/filters";
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
  ui?: AppSettings["ui"];
  locale?: string;
}) {
  const requests: ScoreJobsRequest[] = [];
  const candidateCalls: Array<{ filter: JobFilter; preferredIds: string[] }> = [];
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
      get: async () => ({
        ...(overrides.ai ?? settings("openai-compatible", "http://localhost:11434/v1")),
        ui: overrides.ui ?? DEFAULT_APP_SETTINGS.ui,
      }),
    },
    secrets: { read: async () => (overrides.key === undefined ? "sk-test" : overrides.key) },
    candidateIds: async (filter, preferredIds, limit) => {
      candidateCalls.push({ filter, preferredIds });
      return (overrides.openJobIds ?? ["j2", "j1"]).slice(0, limit);
    },
    systemLocale: () => overrides.locale ?? "en-US",
  });
  return { service, requests, candidateCalls };
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

  it("asks for the explanations in the UI language, or in the system language when the setting follows it", async () => {
    const explicit = deps({ ui: { language: "it" }, locale: "en-US" });
    await explicit.service.start({ consent: false });
    expect(explicit.requests[0]?.language).toBe("it");

    const followsSystemItalian = deps({ ui: { language: "system" }, locale: "it-IT" });
    await followsSystemItalian.service.start({ consent: false });
    expect(followsSystemItalian.requests[0]?.language).toBe("it");

    const followsSystemOther = deps({ ui: { language: "system" }, locale: "fr-FR" });
    await followsSystemOther.service.start({ consent: false });
    expect(followsSystemOther.requests[0]?.language).toBe("en");

    const explicitEnglish = deps({ ui: { language: "en" }, locale: "it-IT" });
    await explicitEnglish.service.start({ consent: false });
    expect(explicitEnglish.requests[0]?.language).toBe("en");
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

    expect(await service.start({ consent: true, consentTarget: "openai" })).toEqual({
      ok: false,
      code: "consent-required",
    });
    expect(requests).toEqual([]);

    const consented = await service.start({ consent: true, consentTarget: "anthropic" });
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

  it("scores the jobs that pass the hard filters, with the visible jobs first, and ignores the new-only view", async () => {
    const { service, candidateCalls } = deps({});

    await service.start({
      consent: false,
      filter: { roles: ["backend"], newOnly: true, hideDismissed: true },
      visibleJobIds: ["j9", "j3"],
    });

    expect(candidateCalls).toHaveLength(1);
    expect(candidateCalls[0]?.filter).toMatchObject({
      roles: ["backend"],
      newOnly: false,
      hideDismissed: true,
    });
    expect(candidateCalls[0]?.preferredIds).toEqual(["j9", "j3"]);
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
      candidateIds: async () => ["j1"],
      systemLocale: () => "en-US",
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
      candidateIds: async () => ["j1"],
      systemLocale: () => "en-US",
    });

    expect(await service.start({ consent: false })).toEqual({
      ok: false,
      code: "engine-unavailable",
    });
  });
});
