import { z } from "zod";
import { formatProfileDate, parseLanguageLevel, parseProfileDate } from "./format";
import type { EmploymentType, SeniorityLevel, WorkMode } from "../normalize/job";

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

const EducationShape = z.strictObject({
  institution: shortText,
  degree: shortText,
  /** The final mark, such as "110/110" or "First class"; optional. */
  grade: shortText,
  startDate: dateText,
  endDate: dateText,
});

/**
 * Profiles saved before the grade existed had a field of study instead. It joins the degree
 * ("BSc" and "Computer Engineering" become "BSc, Computer Engineering"), so nothing is lost.
 */
function migrateEducation(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("field" in value)) return value;
  const { field, ...rest } = value as Record<string, unknown>;
  const degree = typeof rest.degree === "string" ? rest.degree.trim() : "";
  const subject = typeof field === "string" ? field.trim() : "";
  const joined =
    subject === "" || degree.includes(subject)
      ? degree
      : degree === ""
        ? subject
        : `${degree}, ${subject}`;
  return { grade: "", ...rest, degree: joined };
}

export const EducationSchema = z.preprocess(migrateEducation, EducationShape);

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

/** Choices "what you are looking for" offers: the job model's values, without `unknown`. */
export const PREFERRED_WORK_MODES = [
  "remote",
  "hybrid",
  "onsite",
] as const satisfies readonly WorkMode[];
export const PREFERRED_EMPLOYMENT_TYPES = [
  "full_time",
  "part_time",
  "contract",
  "freelance",
  "internship",
  "temporary",
] as const satisfies readonly EmploymentType[];
export const PREFERRED_SENIORITIES = [
  "intern",
  "junior",
  "mid",
  "senior",
  "lead",
] as const satisfies readonly SeniorityLevel[];

/** At most this many roles and places; the company search combines each with each board domain. */
export const PREFERENCE_LIMITS = { roles: 10, locations: 10 } as const;

/**
 * What the person is looking for. Roles and places drive the search for companies; work mode,
 * contract and level filter the jobs list. Empty lists mean "any".
 */
export const JobPreferencesSchema = z.strictObject({
  roles: z.array(requiredShortText).max(PREFERENCE_LIMITS.roles),
  locations: z.array(requiredShortText).max(PREFERENCE_LIMITS.locations),
  workModes: z.array(z.enum(PREFERRED_WORK_MODES)),
  employmentTypes: z.array(z.enum(PREFERRED_EMPLOYMENT_TYPES)),
  seniorities: z.array(z.enum(PREFERRED_SENIORITIES)),
});

export type JobPreferences = z.output<typeof JobPreferencesSchema>;

export function emptyPreferences(): JobPreferences {
  return { roles: [], locations: [], workModes: [], employmentTypes: [], seniorities: [] };
}

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
  // Profiles saved before preferences existed have none: they read as "anything".
  preferences: JobPreferencesSchema.default(emptyPreferences),
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
    preferences: emptyPreferences(),
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

const looseText = z.string();
const looseList = <T extends z.ZodType>(item: T) => z.array(item);

/**
 * An object whose missing keys get their empty value before validation. The JSON schema still
 * lists every key as required, so a schema-constrained model fills each one in, while a model in
 * plain JSON mode that leaves a section out still yields a valid draft.
 */
function withEmptyDefaults<S extends z.ZodRawShape>(defaults: Record<keyof S, unknown>, shape: S) {
  return z.preprocess(
    (value) =>
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? { ...defaults, ...value }
        : value,
    z.object(shape),
  );
}

const EMPTY_DATES = { startDate: "", endDate: "" };

/**
 * What the AI is asked to return for a CV: the same shape as `CvExtractionSchema`, without the
 * length limits, the email and URL checks or non-empty names. A model copies the CV as written
 * (a link as `linkedin.com/in/x`, an over-long bullet), and one such value must not throw away
 * the whole CV: `normalizeCvExtraction` repairs or drops it instead.
 */
export const CvExtractionDraftSchema = withEmptyDefaults(
  {
    contact: { fullName: "", email: "", phone: "", location: "" },
    headline: "",
    summary: "",
    experience: [],
    education: [],
    skills: [],
    languages: [],
    certifications: [],
    links: [],
  },
  {
    contact: withEmptyDefaults(
      { fullName: "", email: "", phone: "", location: "" },
      { fullName: looseText, email: looseText, phone: looseText, location: looseText },
    ),
    headline: looseText,
    summary: looseText,
    experience: looseList(
      withEmptyDefaults(
        { company: "", title: "", location: "", ...EMPTY_DATES, bullets: [] },
        {
          company: looseText,
          title: looseText,
          location: looseText,
          startDate: looseText,
          endDate: looseText,
          bullets: looseList(z.string()),
        },
      ),
    ),
    education: looseList(
      withEmptyDefaults(
        { institution: "", degree: "", grade: "", ...EMPTY_DATES },
        {
          institution: looseText,
          degree: looseText,
          grade: looseText,
          startDate: looseText,
          endDate: looseText,
        },
      ),
    ),
    skills: looseList(
      withEmptyDefaults(
        { name: "", level: "", aliases: [] },
        { name: looseText, level: looseText, aliases: looseList(z.string()) },
      ),
    ),
    languages: looseList(
      withEmptyDefaults({ name: "", level: "" }, { name: looseText, level: looseText }),
    ),
    certifications: looseList(
      withEmptyDefaults(
        { name: "", issuer: "", date: "" },
        { name: looseText, issuer: looseText, date: looseText },
      ),
    ),
    links: looseList(
      withEmptyDefaults({ label: "", url: "" }, { label: looseText, url: looseText }),
    ),
  },
);

export type CvExtractionDraft = z.output<typeof CvExtractionDraftSchema>;

/** Trims a value and cuts it to the limit, so an over-long one is kept shortened, not refused. */
function fit(value: string, limit: number): string {
  return value.trim().slice(0, limit).trim();
}

/**
 * A link as a CV writes it, as an http or https URL: `linkedin.com/in/x` and `www.site.dev` gain
 * `https://`. Null when it is not a web address at all (an email, a handle, plain words).
 */
export function normalizeCvLink(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (!isHttpUrl(withScheme)) return null;
  const host = new URL(withScheme).hostname;
  // A bare word ("GitHub") parses as a host; a web address has a dot in its host.
  if (!host.includes(".") || withScheme.length > PROFILE_LIMITS.url) return null;
  return withScheme;
}

/**
 * Turns what the model returned into a valid extraction: values are trimmed and cut to their
 * limits, links gain `https://` when they lack it, an invalid email is left empty, and entries that
 * stay invalid (a skill without a name, a link that is no address) are dropped. Always valid.
 */
export function normalizeCvExtraction(draft: CvExtractionDraft): CvExtraction {
  const short = (value: string) => fit(value, PROFILE_LIMITS.shortText);
  // A date the parser reads is stored as YYYY-MM, YYYY or "present"; any other is kept as written.
  const date = (value: string) => {
    const parsed = parseProfileDate(value);
    return parsed === null ? fit(value, PROFILE_LIMITS.dateText) : formatProfileDate(parsed);
  };
  const email = fit(draft.contact.email, PROFILE_LIMITS.email);
  const extraction: CvExtraction = {
    contact: {
      fullName: short(draft.contact.fullName),
      email: EMAIL_PATTERN.test(email) ? email : "",
      phone: short(draft.contact.phone),
      location: short(draft.contact.location),
    },
    headline: short(draft.headline),
    summary: fit(draft.summary, PROFILE_LIMITS.longText),
    experience: draft.experience.slice(0, PROFILE_LIMITS.listItems).map((item) => ({
      company: short(item.company),
      title: short(item.title),
      location: short(item.location),
      startDate: date(item.startDate),
      endDate: date(item.endDate),
      bullets: item.bullets
        .map((bullet) => fit(bullet, PROFILE_LIMITS.bulletText))
        .filter((bullet) => bullet !== "")
        .slice(0, PROFILE_LIMITS.bullets),
    })),
    education: draft.education.slice(0, 20).map((item) => ({
      institution: short(item.institution),
      degree: short(item.degree),
      grade: short(item.grade),
      startDate: date(item.startDate),
      endDate: date(item.endDate),
    })),
    skills: draft.skills
      .map((item) => ({
        name: short(item.name),
        level: short(item.level),
        aliases: item.aliases
          .map(short)
          .filter((alias) => alias !== "")
          .slice(0, PROFILE_LIMITS.aliases),
      }))
      .filter((item) => item.name !== "")
      .slice(0, PROFILE_LIMITS.skills),
    languages: draft.languages
      .map((item) => ({
        name: short(item.name),
        level: parseLanguageLevel(item.level) ?? short(item.level),
      }))
      .filter((item) => item.name !== "")
      .slice(0, 20),
    certifications: draft.certifications
      .map((item) => ({
        name: short(item.name),
        issuer: short(item.issuer),
        date: date(item.date),
      }))
      .filter((item) => item.name !== "")
      .slice(0, 30),
    links: draft.links
      .flatMap((item) => {
        const url = normalizeCvLink(item.url);
        return url === null ? [] : [{ label: short(item.label), url }];
      })
      .slice(0, 10),
  };
  // The repairs above keep every value inside the strict schema; parsing proves it.
  return CvExtractionSchema.parse(extraction);
}

export {
  LANGUAGE_LEVELS,
  PRESENT,
  formatProfileDate,
  parseLanguageLevel,
  parseProfileDate,
  type LanguageLevel,
  type ProfileDate,
} from "./format";
