// protects=the profile review shows the checks without an AI and the stored written review only while it is for the profile, its roles and the language as they are now; the written review needs a profile, an AI, the cloud consent (kept once given), sends the engine the ranking fields and roles but never the contact details, links or answers, stores the result, and reports failures as codes;
// fails_when=contact details, links or standard answers reach the engine, a review of an older profile or another language is shown, a cloud provider is called without consent, a failed run is stored, the AI off still calls the engine, or the skills check runs with no role;
// no_claim=the quality of the advice and the live provider, which the core tests script and a live run shows;
import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS, aiConsentTarget, type AppSettings } from "@job-finder/bridge";
import { emptyProfile, type Profile } from "@job-finder/core/profile";
import { REVIEW_PROMPT_VERSION } from "@job-finder/core/profile/review-ai";
import type { ReviewProfileRequest } from "../../engine/protocol";
import { EngineUnavailableError } from "../engine/supervisor";
import { createProfileReviewService, type ProfileReviewEngine } from "./review";
import type { StoredProfileReview } from "./review-store";

const REVIEW = { summary: "Solid.", suggestions: [] };

function profile(): Profile {
  return {
    ...emptyProfile(),
    contact: {
      fullName: "Maria Rossi",
      email: "maria.secret@example.com",
      phone: "+39 333",
      location: "Milano",
    },
    headline: "Backend engineer",
    summary: "Short.",
    links: [{ label: "GitHub", url: "https://github.com/maria-secret" }],
    standardAnswers: [{ question: "Why?", answer: "Private answer." }],
    preferences: {
      ...emptyProfile().preferences,
      roles: ["Backend Engineer"],
      locations: ["Italia"],
    },
  } as Profile;
}

function setup(options: {
  ai?: Partial<AppSettings["ai"]>;
  saved?: Profile | null;
  engine?: ProfileReviewEngine["reviewProfile"];
  stored?: StoredProfileReview | null;
  texts?: string[];
  language?: "en" | "it";
}) {
  let stored = options.stored ?? null;
  const updates: unknown[] = [];
  const requests: ReviewProfileRequest[] = [];
  const marketCalls: unknown[] = [];
  const service = createProfileReviewService({
    profile: {
      get: async () =>
        options.saved === null
          ? null
          : { profile: options.saved ?? profile(), version: 3, updatedAt: 1 },
    },
    settings: {
      get: async () => ({
        ...DEFAULT_APP_SETTINGS,
        ui: { language: options.language ?? "en" },
        ai: {
          ...DEFAULT_APP_SETTINGS.ai,
          enabled: true,
          provider: "anthropic",
          model: "m",
          ...options.ai,
        },
      }),
      update: async (patch) => {
        updates.push(patch);
        return DEFAULT_APP_SETTINGS;
      },
    },
    secrets: { read: async () => "sk-test" },
    engine: {
      reviewProfile:
        options.engine ??
        (async (request) => {
          requests.push(request);
          return { ok: true, review: REVIEW };
        }),
    },
    store: {
      get: async () => stored,
      set: async (value) => {
        stored = value;
      },
    },
    marketTexts: async (filter, limit) => {
      marketCalls.push({ filter, limit });
      return options.texts ?? [];
    },
    systemLocale: () => "en-US",
    now: () => 1000,
  });
  return { service, updates, requests, marketCalls, stored: () => stored };
}

describe("profile review: the checks", () => {
  it("answers that there is nothing to review before a profile is saved", async () => {
    const { service } = setup({ saved: null });
    expect(await service.get()).toMatchObject({ hasProfile: false, findings: [] });
  });

  it("finds what a thin profile lacks, and compares skills with the postings for the roles only when there are roles", async () => {
    const texts = Array.from({ length: 30 }, (_, index) =>
      index < 20 ? "Kubernetes and Docker" : "Other",
    );
    const withRoles = setup({ texts });
    const view = await withRoles.service.get();
    const codes = view.findings.map((item) => item.code);
    expect(codes).toContain("short-summary");
    expect(codes).toContain("no-experience");
    const gaps = view.findings.filter((item) => item.code === "market-skill-missing");
    expect(gaps.map((item) => item.params["skill"]).sort()).toEqual(["Docker", "Kubernetes"]);
    expect(gaps[0]?.params["percent"]).toBe(67);
    expect(view.marketJobs).toBe(30);

    const noRoles = setup({
      saved: { ...profile(), preferences: { ...profile().preferences, roles: [] } },
      texts,
    });
    const without = await noRoles.service.get();
    expect(without.findings.map((item) => item.code)).toContain("no-roles");
    expect(without.marketJobs).toBe(0);
    expect(noRoles.marketCalls).toEqual([]);
  });

  it("shows the stored written review only for the same profile, roles, language and prompt", async () => {
    const run = setup({});
    expect((await run.service.get()).ai.review).toBeNull();
    await run.service.reviewWithAi({
      consent: true,
      consentTarget: aiConsentTarget({ provider: "anthropic", baseUrl: "" }),
    });

    const stored = run.stored()!;
    expect((await setup({ stored }).service.get()).ai).toMatchObject({
      review: REVIEW,
      reviewedAt: 1000,
    });
    expect((await setup({ stored, language: "it" }).service.get()).ai.review).toBeNull();
    expect(
      (
        await setup({
          stored: { ...stored, promptVersion: REVIEW_PROMPT_VERSION + 1 },
        }).service.get()
      ).ai.review,
    ).toBeNull();
    const changed = { ...profile(), headline: "Frontend engineer" };
    expect((await setup({ stored, saved: changed }).service.get()).ai.review).toBeNull();
    const otherRoles = {
      ...profile(),
      preferences: { ...profile().preferences, roles: ["Data Engineer"] },
    };
    expect((await setup({ stored, saved: otherRoles }).service.get()).ai.review).toBeNull();
    // Contact details are not part of what the review depends on.
    const otherContact = { ...profile(), contact: { ...profile().contact, phone: "+39 000" } };
    expect((await setup({ stored, saved: otherContact }).service.get()).ai.review).toEqual(REVIEW);
  });

  it("says whether the AI is on and whether a cloud provider still needs the user's agreement", async () => {
    expect((await setup({ ai: { enabled: false } }).service.get()).ai).toMatchObject({
      enabled: false,
      needsConsent: false,
    });
    expect((await setup({}).service.get()).ai).toMatchObject({ enabled: true, needsConsent: true });
    const target = aiConsentTarget({ provider: "anthropic", baseUrl: "" });
    expect((await setup({ ai: { consentTarget: target } }).service.get()).ai.needsConsent).toBe(
      false,
    );
  });
});

describe("profile review: the written review", () => {
  const target = aiConsentTarget({ provider: "anthropic", baseUrl: "" });

  it("sends the ranking fields and the roles without contact details, links or answers, keeps the review and the consent", async () => {
    const run = setup({});
    const result = await run.service.reviewWithAi({ consent: true, consentTarget: target });

    expect(result).toEqual({ ok: true, review: REVIEW, reviewedAt: 1000 });
    const sent = JSON.stringify(run.requests[0]);
    expect(sent).not.toContain("maria.secret@example.com");
    expect(sent).not.toContain("+39 333");
    expect(sent).not.toContain("maria-secret");
    expect(sent).not.toContain("Private answer");
    expect(sent).toContain("Backend engineer");
    expect(run.requests[0]?.profile.preferences.roles).toEqual(["Backend Engineer"]);
    expect(run.requests[0]?.ai.config).toMatchObject({ provider: "anthropic", apiKey: "sk-test" });
    expect(run.updates).toEqual([{ ai: { consentTarget: target } }]);
    expect(run.stored()?.review).toEqual(REVIEW);
  });

  it("does not call the engine without a profile, with the AI off, or without the consent a cloud provider needs", async () => {
    const calls: unknown[] = [];
    const engine: ProfileReviewEngine["reviewProfile"] = async (request) => {
      calls.push(request);
      return { ok: true, review: REVIEW };
    };
    expect(await setup({ saved: null, engine }).service.reviewWithAi({})).toEqual({
      ok: false,
      code: "no-profile",
    });
    expect(
      await setup({ ai: { enabled: false }, engine }).service.reviewWithAi({
        consent: true,
        consentTarget: target,
      }),
    ).toEqual({ ok: false, code: "not-configured" });
    expect(await setup({ engine }).service.reviewWithAi({ consent: false })).toEqual({
      ok: false,
      code: "consent-required",
    });
    expect(calls).toEqual([]);
    // A model on this computer needs no consent.
    const local = setup({
      ai: { provider: "openai-compatible", baseUrl: "http://localhost:11434/v1" },
      engine,
    });
    expect((await local.service.reviewWithAi({})).ok).toBe(true);
    expect(local.updates).toEqual([]);
  });

  it("reports the engine's code, an engine that is gone, and an unexpected failure, and stores nothing", async () => {
    const failed = setup({ engine: async () => ({ ok: false, code: "invalid-key" }) });
    expect(await failed.service.reviewWithAi({ consent: true, consentTarget: target })).toEqual({
      ok: false,
      code: "invalid-key",
    });
    expect(failed.stored()).toBeNull();

    const gone = setup({
      engine: async () => {
        throw new EngineUnavailableError("crashed");
      },
    });
    expect(await gone.service.reviewWithAi({ consent: true, consentTarget: target })).toEqual({
      ok: false,
      code: "engine-unavailable",
    });
    const broken = setup({
      engine: async () => {
        throw new Error("boom");
      },
    });
    expect(await broken.service.reviewWithAi({ consent: true, consentTarget: target })).toEqual({
      ok: false,
      code: "unknown",
    });
  });
});
