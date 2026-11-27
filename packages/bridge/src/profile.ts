import { z } from "zod";
import type { CvExtraction, Profile } from "@job-finder/core/profile";
import type { AiProfileReview, RuleFinding } from "@job-finder/core/profile/review-types";

export type {
  AiProfileReview,
  AiSuggestion,
  RuleFinding,
} from "@job-finder/core/profile/review-types";

/** Largest CV upload the renderer may send. Must equal `CV_MAX_BYTES` in packages/core/src/cv (tested). */
export const CV_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Why a CV import failed. The first four are file checks, `consent-required` means the user has not
 * agreed to send the CV to a cloud provider, `engine-unavailable` means the engine could not answer;
 * the rest mirror the AI layer's error codes (must equal `AI_ERROR_CODES` in packages/core/src/ai, tested).
 */
export const CV_IMPORT_FAILURE_CODES = [
  "unsupported-type",
  "too-large",
  "unreadable",
  "empty-document",
  "consent-required",
  "engine-unavailable",
  "cancelled",
  "not-configured",
  "invalid-key",
  "model-not-found",
  "rate-limited",
  "unreachable",
  "timeout",
  "invalid-output",
  "unknown",
] as const;
export type CvImportFailureCode = (typeof CV_IMPORT_FAILURE_CODES)[number];

/** Mirrors `AiWarning` in packages/core/src/ai/structured.ts; desktop typecheck checks the two stay compatible. */
export interface CvImportWarning {
  code: "context-exceeded";
  estimatedTokens: number;
  contextSize: number;
}

/** Outcome of an import: a CV-derived draft for review, or a code. Never the CV text or a provider error body. */
export type CvImportResult =
  | { ok: true; extraction: CvExtraction; warnings: CvImportWarning[] }
  | { ok: false; code: CvImportFailureCode };

/** The saved profile with its scoring version. `updatedAt` is epoch milliseconds. */
export interface ProfileRecord {
  profile: Profile;
  version: number;
  updatedAt: number;
}

export const CvImportRequestSchema = z.strictObject({
  fileName: z.string().trim().min(1).max(255),
  bytes: z
    .instanceof(Uint8Array)
    .refine((bytes) => bytes.byteLength <= CV_UPLOAD_MAX_BYTES, "The CV file is too large"),
  /** The user has seen the consent note and agreed to send the CV to the configured provider. */
  consent: z.boolean(),
  /** The provider and host the consent was given for (`aiConsentTarget`). */
  consentTarget: z.string().optional(),
});

export type CvImportRequest = z.input<typeof CvImportRequestSchema>;

// The renderer builds and validates profile drafts with these; they come from core but load no Node code.
export {
  ProfileSchema,
  emptyProfile,
  PROFILE_LIMITS,
  SALARY_PERIODS,
  LANGUAGE_LEVELS,
  PRESENT,
  PREFERENCE_LIMITS,
  PREFERRED_EMPLOYMENT_TYPES,
  PREFERRED_SENIORITIES,
  PREFERRED_WORK_MODES,
  emptyPreferences,
  formatProfileDate,
  parseLanguageLevel,
  parseProfileDate,
} from "@job-finder/core/profile";
export type {
  CvExtraction,
  Profile,
  ProfileApplicationDefaults,
  ProfileContact,
  ProfileExperience,
  SalaryPeriod,
  LanguageLevel,
  ProfileDate,
  JobPreferences,
} from "@job-finder/core/profile";

/**
 * The review of the saved profile. `findings` are the checks that need no AI, computed each time;
 * `ai` is the written review, which is kept until the profile changes.
 */
export interface ProfileReviewView {
  /** False before a profile is saved: there is nothing to review. */
  hasProfile: boolean;
  findings: RuleFinding[];
  /** Postings for the profile's roles read for the skills check; 0 when there were too few. */
  marketJobs: number;
  ai: {
    /** An AI provider is chosen. */
    enabled: boolean;
    /** A cloud provider the user has not agreed to send the profile to yet. */
    needsConsent: boolean;
    /** The review of the profile as it is now, or null when none was asked for. */
    review: AiProfileReview | null;
    /** Epoch milliseconds of that review. */
    reviewedAt: number | null;
  };
}

/** Why the written review could not be made. The last seven mirror the AI layer's error codes. */
export const PROFILE_REVIEW_FAILURE_CODES = [
  "no-profile",
  "consent-required",
  "engine-unavailable",
  "not-configured",
  "invalid-key",
  "model-not-found",
  "rate-limited",
  "unreachable",
  "timeout",
  "invalid-output",
  "unknown",
] as const;
export type ProfileReviewFailureCode = (typeof PROFILE_REVIEW_FAILURE_CODES)[number];

export type ProfileReviewAiResult =
  | { ok: true; review: AiProfileReview; reviewedAt: number }
  | { ok: false; code: ProfileReviewFailureCode };

export const ProfileReviewAiRequestSchema = z.strictObject({
  /** The user agreed to send the profile to the configured cloud provider. */
  consent: z.boolean().optional(),
  /** The provider and host the consent was given for (`aiConsentTarget`). */
  consentTarget: z.string().max(600).optional(),
});
export type ProfileReviewAiRequest = z.infer<typeof ProfileReviewAiRequestSchema>;
