// Pure types of a profile review, shared by the engine, main and the renderer bridge. No imports.

/** The parts of a profile a finding or a suggestion points at. */
export const REVIEW_SECTIONS = [
  "headline",
  "summary",
  "experience",
  "education",
  "skills",
  "languages",
  "certifications",
  "links",
  "preferences",
] as const;
export type ReviewSection = (typeof REVIEW_SECTIONS)[number];

export type ReviewSeverity = "high" | "medium" | "low";

/**
 * What a check found. The screen writes the sentence from `code` and `params`, in the user's
 * language, so these checks work with no AI.
 */
export const RULE_CODES = [
  "no-headline",
  "no-summary",
  "short-summary",
  "no-experience",
  "experience-no-bullets",
  "experience-no-dates",
  "no-numbers",
  "no-skills",
  "few-skills",
  "unbacked-skills",
  "no-languages",
  "no-education",
  "no-links",
  "no-roles",
  "no-places",
  "market-skill-missing",
] as const;
export type RuleCode = (typeof RULE_CODES)[number];

export interface RuleFinding {
  code: RuleCode;
  section: ReviewSection;
  severity: ReviewSeverity;
  /** Numbers and names the sentence quotes: a count, a skill, a share of the postings. */
  params: Record<string, string | number>;
}

/** The written review the AI gives. */
export interface AiProfileReview {
  /** Two or three sentences: where the profile stands. */
  summary: string;
  suggestions: AiSuggestion[];
}

export interface AiSuggestion {
  section: ReviewSection;
  title: string;
  advice: string;
  /** A sentence rewritten from the profile's own facts, or empty. */
  example: string;
}
