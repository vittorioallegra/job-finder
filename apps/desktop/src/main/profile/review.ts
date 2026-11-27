import {
  aiConsentTarget,
  hasAiConsent,
  isCloudAiEndpoint,
  type ProfileReviewAiRequest,
  type ProfileReviewAiResult,
  type ProfileReviewView,
} from "@job-finder/bridge";
import { filterFromPreferences, type JobFilter } from "@job-finder/core/filters";
import { emptyProfile, scoringFields, type Profile } from "@job-finder/core/profile";
import {
  marketSkillGaps,
  reviewProfileRules,
  type MarketSkill,
} from "@job-finder/core/profile/review";
import { REVIEW_PROMPT_VERSION } from "@job-finder/core/profile/review-ai";
import type { ReviewProfileOutcome } from "@job-finder/core/profile/review-ai";
import { profileHash } from "@job-finder/core/ranking";
import type { ReviewProfileRequest } from "../../engine/protocol";
import { readAiKey } from "../ai/keys";
import { EngineUnavailableError } from "../engine/supervisor";
import { explanationLanguage } from "../scoring/service";
import type { SecretStore } from "../secrets/store";
import type { SettingsRepository } from "../settings/repository";
import type { ProfileRepository } from "./repository";
import type { ProfileReviewStore } from "./review-store";

/** Postings read for the skills check, newest first. */
export const MARKET_JOBS_LIMIT = 600;

export interface ProfileReviewEngine {
  reviewProfile(request: ReviewProfileRequest): Promise<ReviewProfileOutcome>;
}

export interface ProfileReviewService {
  /** The checks that need no AI, and the stored written review when it is for the profile as it is now. */
  get(): Promise<ProfileReviewView>;
  /** Asks the AI for the written review, keeps it and returns it. */
  reviewWithAi(request: ProfileReviewAiRequest): Promise<ProfileReviewAiResult>;
}

export interface ProfileReviewServiceOptions {
  profile: Pick<ProfileRepository, "get">;
  settings: Pick<SettingsRepository, "get" | "update">;
  secrets: Pick<SecretStore, "read">;
  engine: ProfileReviewEngine;
  store: ProfileReviewStore;
  /** The text of the newest open jobs that pass the filter. */
  marketTexts(filter: JobFilter, limit: number): Promise<string[]>;
  /** The OS locale, used when the UI language setting is "system". */
  systemLocale(): string;
  now?: () => number;
}

/** The profile fields the review depends on: the ranking fields and the roles it is judged for. */
function reviewHash(profile: Profile): string {
  return `${profileHash(profile)}:${JSON.stringify(profile.preferences.roles)}`;
}

/**
 * What the AI gets: the ranking fields and the target roles, never the contact details, links,
 * application defaults or standard answers.
 */
function reviewProfileFor(profile: Profile): Profile {
  return {
    ...emptyProfile(),
    ...scoringFields(profile),
    preferences: { ...emptyProfile().preferences, roles: profile.preferences.roles },
  };
}

/**
 * Main side of the profile review. The rule checks and the skills check run here with no AI; the
 * written review is one call in the engine, after the same cloud consent as a scoring run, and is
 * kept until the profile, its roles or the language change.
 */
export function createProfileReviewService(
  options: ProfileReviewServiceOptions,
): ProfileReviewService {
  const now = options.now ?? (() => Date.now());

  async function market(
    profile: Profile,
    maxAgeDays: number,
  ): Promise<{ gaps: MarketSkill[]; jobs: number } | null> {
    // Without roles every posting would be read, and the shares would mean nothing.
    if (profile.preferences.roles.length === 0) return null;
    const filter = filterFromPreferences(profile.preferences, maxAgeDays);
    const texts = await options.marketTexts(filter, MARKET_JOBS_LIMIT);
    return { gaps: marketSkillGaps(profile, texts), jobs: texts.length };
  }

  return {
    async get() {
      const saved = await options.profile.get();
      const { ai, jobs, ui } = await options.settings.get();
      const base = {
        enabled: ai.enabled,
        needsConsent:
          ai.enabled && isCloudAiEndpoint(ai) && ai.consentTarget !== aiConsentTarget(ai),
      };
      if (saved === null) {
        return {
          hasProfile: false,
          findings: [],
          marketJobs: 0,
          ai: { ...base, review: null, reviewedAt: null },
        };
      }
      const compared = await market(saved.profile, jobs.maxAgeDays);
      const stored = await options.store.get();
      const language = explanationLanguage(ui.language, options.systemLocale());
      const current =
        stored !== null &&
        stored.profileHash === reviewHash(saved.profile) &&
        stored.language === language &&
        stored.promptVersion === REVIEW_PROMPT_VERSION
          ? stored
          : null;
      return {
        hasProfile: true,
        findings: reviewProfileRules(saved.profile, compared?.gaps ?? null),
        marketJobs: compared?.jobs ?? 0,
        ai: {
          ...base,
          review: current?.review ?? null,
          reviewedAt: current?.createdAt ?? null,
        },
      };
    },

    async reviewWithAi(request) {
      const saved = await options.profile.get();
      if (saved === null) return { ok: false, code: "no-profile" };
      const { ai, ui } = await options.settings.get();
      if (!ai.enabled) return { ok: false, code: "not-configured" };
      if (!hasAiConsent(ai, request)) return { ok: false, code: "consent-required" };
      // The consent given here is kept, so a later scan can score its new jobs without asking again.
      if (isCloudAiEndpoint(ai) && ai.consentTarget !== aiConsentTarget(ai)) {
        await options.settings.update({ ai: { consentTarget: aiConsentTarget(ai) } });
      }
      const language = explanationLanguage(ui.language, options.systemLocale());
      const apiKey = await readAiKey(options.secrets, ai);
      let outcome: ReviewProfileOutcome;
      try {
        outcome = await options.engine.reviewProfile({
          profile: reviewProfileFor(saved.profile),
          language,
          ai: {
            config: { provider: ai.provider, model: ai.model, baseUrl: ai.baseUrl, apiKey },
            contextSize: ai.contextSize,
          },
        });
      } catch (error) {
        if (error instanceof EngineUnavailableError)
          return { ok: false, code: "engine-unavailable" };
        return { ok: false, code: "unknown" };
      }
      if (!outcome.ok) return { ok: false, code: outcome.code };
      const createdAt = now();
      await options.store.set({
        profileHash: reviewHash(saved.profile),
        language,
        promptVersion: REVIEW_PROMPT_VERSION,
        createdAt,
        review: outcome.review,
      });
      return { ok: true, review: outcome.review, reviewedAt: createdAt };
    },
  };
}
