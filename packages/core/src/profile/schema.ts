import { z } from "zod";

/**
 * Profile domain schema. Pure: no Node or Electron imports, so the renderer can load it through
 * the bridge. Empty strings mean "not filled in"; blank list rows are dropped by the editor before
 * validation. Dates are free text because CVs write them in many shapes.
 */
export const PROFILE_LIMITS = {
  shortText: 200,
  longText: 4000,
  bulletText: 500,
  dateText: 40,
  email: 254,
  url: 500,
  listItems: 50,
  bullets: 30,
  skills: 200,
  aliases: 10,
  salary: 100_000_000,
} as const;

const shortText = z.string().trim().max(PROFILE_LIMITS.shortText);
const requiredShortText = shortText.min(1);
const longText = z.string().trim().max(PROFILE_LIMITS.longText);
const dateText = z.string().trim().max(PROFILE_LIMITS.dateText);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export const ContactSchema = z.strictObject({
  fullName: shortText,
  email: z
    .string()
    .trim()
    .max(PROFILE_LIMITS.email)
    .refine((value) => value === "" || EMAIL_PATTERN.test(value), "Not an email address"),
  phone: shortText,
  location: shortText,
});

export const ExperienceSchema = z.strictObject({
  company: shortText,
  title: shortText,
  location: shortText,
  startDate: dateText,
  endDate: dateText,
  bullets: z.array(z.string().trim().max(PROFILE_LIMITS.bulletText)).max(PROFILE_LIMITS.bullets),
});

export const EducationSchema = z.strictObject({
  institution: shortText,
  degree: shortText,
  field: shortText,
  startDate: dateText,
  endDate: dateText,
});

export const SkillSchema = z.strictObject({
  name: requiredShortText,
  level: shortText,
  aliases: z.array(requiredShortText).max(PROFILE_LIMITS.aliases),
});

export const LanguageSchema = z.strictObject({
  name: requiredShortText,
  level: shortText,
});

export const CertificationSchema = z.strictObject({
  name: requiredShortText,
  issuer: shortText,
  date: dateText,
});

export const LinkSchema = z.strictObject({
  label: shortText,
  url: z
    .string()
    .trim()
    .min(1)
    .max(PROFILE_LIMITS.url)
    .refine(isHttpUrl, "A link must be an http or https URL"),
});

export const WorkAuthorizationSchema = z.strictObject({
  country: z.string().trim().regex(COUNTRY_PATTERN, "Use a two-letter country code"),
  status: requiredShortText,
});

export const SALARY_PERIODS = ["", "hour", "day", "month", "year"] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

export const SalarySchema = z.strictObject({
  amount: z.number().min(0).max(PROFILE_LIMITS.salary).nullable(),
  currency: z.union([z.literal(""), z.string().trim().regex(CURRENCY_PATTERN)]),
  period: z.enum(SALARY_PERIODS),
});

export const ApplicationDefaultsSchema = z.strictObject({
  workAuthorization: z.array(WorkAuthorizationSchema).max(PROFILE_LIMITS.listItems),
  noticePeriod: shortText,
  salary: SalarySchema,
  willingToRelocate: z.boolean().nullable(),
  pronouns: shortText,
});

export const StandardAnswerSchema = z.strictObject({
  question: requiredShortText,
  answer: z.string().trim().min(1).max(PROFILE_LIMITS.longText),
});

export const ProfileSchema = z.strictObject({
  contact: ContactSchema,
  headline: shortText,
  summary: longText,
  experience: z.array(ExperienceSchema).max(PROFILE_LIMITS.listItems),
  education: z.array(EducationSchema).max(20),
  skills: z.array(SkillSchema).max(PROFILE_LIMITS.skills),
  languages: z.array(LanguageSchema).max(20),
  certifications: z.array(CertificationSchema).max(30),
  links: z.array(LinkSchema).max(10),
  applicationDefaults: ApplicationDefaultsSchema,
  standardAnswers: z.array(StandardAnswerSchema).max(PROFILE_LIMITS.listItems),
});

export type Profile = z.output<typeof ProfileSchema>;
export type ProfileContact = z.output<typeof ContactSchema>;
export type ProfileExperience = z.output<typeof ExperienceSchema>;
export type ProfileApplicationDefaults = z.output<typeof ApplicationDefaultsSchema>;

const EMPTY_CONTACT: ProfileContact = { fullName: "", email: "", phone: "", location: "" };

/** A profile with nothing filled in. Application defaults start unset (no salary, no answer). */
export function emptyProfile(): Profile {
  return {
    contact: { ...EMPTY_CONTACT },
    headline: "",
    summary: "",
    experience: [],
    education: [],
    skills: [],
    languages: [],
    certifications: [],
    links: [],
    applicationDefaults: {
      workAuthorization: [],
      noticePeriod: "",
      salary: { amount: null, currency: "", period: "" },
      willingToRelocate: null,
      pronouns: "",
    },
    standardAnswers: [],
  };
}

/** The profile fields ranking depends on. */
export type ScoringFields = Pick<
  Profile,
  "headline" | "summary" | "experience" | "education" | "skills" | "languages" | "certifications"
>;

/** The ranking fields of a profile. Only these are sent to the AI for scoring. */
export function scoringFields(profile: ScoringFields): ScoringFields {
  return {
    headline: profile.headline,
    summary: profile.summary,
    experience: profile.experience,
    education: profile.education,
    skills: profile.skills,
    languages: profile.languages,
    certifications: profile.certifications,
  };
}

/**
 * The fields ranking depends on. Editing contact details, links, application defaults or standard
 * answers does not change them, so it does not start a new profile version.
 */
export function scoringSnapshot(profile: ScoringFields): string {
  return JSON.stringify(scoringFields(profile));
}

/**
 * What the AI extracts from a CV. Missing sections default to empty, so a model that omits an
 * empty list still produces a valid result. Unknown top-level keys are dropped.
 */
export const CvExtractionSchema = z.object({
  contact: ContactSchema.default(EMPTY_CONTACT),
  headline: shortText.default(""),
  summary: longText.default(""),
  experience: z.array(ExperienceSchema).max(PROFILE_LIMITS.listItems).default([]),
  education: z.array(EducationSchema).max(20).default([]),
  skills: z.array(SkillSchema).max(PROFILE_LIMITS.skills).default([]),
  languages: z.array(LanguageSchema).max(20).default([]),
  certifications: z.array(CertificationSchema).max(30).default([]),
  links: z.array(LinkSchema).max(10).default([]),
});

export type CvExtraction = z.output<typeof CvExtractionSchema>;

/** Applies a CV extraction to a profile: CV-derived sections replace the old ones, the rest is kept. */
export function applyCvExtraction(profile: Profile, extraction: CvExtraction): Profile {
  return { ...profile, ...extraction };
}
