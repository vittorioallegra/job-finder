import {
  ProfileSchema,
  type CvExtraction,
  type Profile,
  type ProfileContact,
  type SalaryPeriod,
} from "@job-finder/bridge";

/** Form state. Every field is text while editing; lists are edited row by row and blank rows are dropped on save. */
export interface ProfileDraft {
  contact: ProfileContact;
  headline: string;
  summary: string;
  experience: ExperienceDraft[];
  education: EducationDraft[];
  skills: SkillDraft[];
  languages: NameLevelDraft[];
  certifications: CertificationDraft[];
  links: LinkDraft[];
  applicationDefaults: DefaultsDraft;
  standardAnswers: AnswerDraft[];
}

export interface ExperienceDraft {
  company: string;
  title: string;
  location: string;
  startDate: string;
  endDate: string;
  /** One bullet per line. */
  bullets: string;
}

export interface EducationDraft {
  institution: string;
  degree: string;
  field: string;
  startDate: string;
  endDate: string;
}

export interface SkillDraft {
  name: string;
  level: string;
  /** Comma-separated alternative names, such as "TS" for TypeScript. */
  aliases: string;
}

export interface NameLevelDraft {
  name: string;
  level: string;
}

export interface CertificationDraft {
  name: string;
  issuer: string;
  date: string;
}

export interface LinkDraft {
  label: string;
  url: string;
}

export interface WorkAuthorizationDraft {
  country: string;
  status: string;
}

export interface DefaultsDraft {
  workAuthorization: WorkAuthorizationDraft[];
  noticePeriod: string;
  salaryAmount: string;
  salaryCurrency: string;
  salaryPeriod: SalaryPeriod;
  willingToRelocate: "" | "yes" | "no";
  pronouns: string;
}

export interface AnswerDraft {
  question: string;
  answer: string;
}

export function draftFromProfile(profile: Profile): ProfileDraft {
  const defaults = profile.applicationDefaults;
  return {
    contact: { ...profile.contact },
    headline: profile.headline,
    summary: profile.summary,
    experience: profile.experience.map((item) => ({
      ...item,
      bullets: item.bullets.join("\n"),
    })),
    education: profile.education.map((item) => ({ ...item })),
    skills: profile.skills.map((item) => ({ ...item, aliases: item.aliases.join(", ") })),
    languages: profile.languages.map((item) => ({ ...item })),
    certifications: profile.certifications.map((item) => ({ ...item })),
    links: profile.links.map((item) => ({ ...item })),
    applicationDefaults: {
      workAuthorization: defaults.workAuthorization.map((item) => ({ ...item })),
      noticePeriod: defaults.noticePeriod,
      salaryAmount: defaults.salary.amount === null ? "" : String(defaults.salary.amount),
      salaryCurrency: defaults.salary.currency,
      salaryPeriod: defaults.salary.period,
      willingToRelocate:
        defaults.willingToRelocate === null ? "" : defaults.willingToRelocate ? "yes" : "no",
      pronouns: defaults.pronouns,
    },
    standardAnswers: profile.standardAnswers.map((item) => ({ ...item })),
  };
}

/** A draft seeded from a CV extraction: CV sections come from the extraction, the rest stays empty. */
export function draftFromExtraction(extraction: CvExtraction, empty: Profile): ProfileDraft {
  return draftFromProfile({ ...empty, ...extraction });
}

function isBlank(values: readonly string[]): boolean {
  return values.every((value) => value.trim() === "");
}

function splitList(text: string, separator: RegExp): string[] {
  return text
    .split(separator)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/**
 * Turns the form into a profile, dropping rows left completely blank. Returns null when a value
 * fails the profile schema, so the caller can ask the user to fix it instead of saving.
 */
export function profileFromDraft(draft: ProfileDraft): Profile | null {
  const amountText = draft.applicationDefaults.salaryAmount.trim();
  const amount = amountText === "" ? null : Number(amountText);
  const candidate = {
    contact: draft.contact,
    headline: draft.headline,
    summary: draft.summary,
    experience: draft.experience
      .filter((item) => !isBlank(Object.values(item)))
      .map((item) => ({ ...item, bullets: splitList(item.bullets, /\n/) })),
    education: draft.education.filter((item) => !isBlank(Object.values(item))),
    skills: draft.skills
      .filter((item) => !isBlank(Object.values(item)))
      .map((item) => ({
        name: item.name,
        level: item.level,
        aliases: splitList(item.aliases, /,/),
      })),
    languages: draft.languages.filter((item) => !isBlank(Object.values(item))),
    certifications: draft.certifications.filter((item) => !isBlank(Object.values(item))),
    links: draft.links.filter((item) => !isBlank(Object.values(item))),
    applicationDefaults: {
      workAuthorization: draft.applicationDefaults.workAuthorization
        .filter((item) => !isBlank(Object.values(item)))
        .map((item) => ({ country: item.country.trim().toUpperCase(), status: item.status })),
      noticePeriod: draft.applicationDefaults.noticePeriod,
      salary: {
        amount,
        currency: draft.applicationDefaults.salaryCurrency.trim().toUpperCase(),
        period: draft.applicationDefaults.salaryPeriod,
      },
      willingToRelocate:
        draft.applicationDefaults.willingToRelocate === ""
          ? null
          : draft.applicationDefaults.willingToRelocate === "yes",
      pronouns: draft.applicationDefaults.pronouns,
    },
    standardAnswers: draft.standardAnswers.filter((item) => !isBlank(Object.values(item))),
  };
  const parsed = ProfileSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
