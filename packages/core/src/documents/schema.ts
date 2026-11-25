import { z } from "zod";
import type { Profile } from "../profile/schema";

/**
 * Application document domain: the tailored CV and the cover letter, and the validator that keeps
 * them to the profile's facts. Pure (zod and types only), so the bridge can import it.
 */
export const DOCUMENT_KINDS = ["cv", "cover-letter"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_LIMITS = {
  text: 200,
  date: 40,
  summary: 1200,
  bullet: 500,
  bulletsPerEntry: 12,
  experience: 50,
  education: 20,
  skills: 60,
  paragraph: 1200,
  paragraphs: 8,
} as const;

const shortText = z.string().trim().max(DOCUMENT_LIMITS.text);
const dateText = z.string().trim().max(DOCUMENT_LIMITS.date);
/** Index of the profile item a document entry was taken from (`profile.experience[source]` and so on). */
const source = z.number().int().min(0).max(999);

export const TailoredBulletSchema = z.strictObject({
  /** Index into the bullets of the experience entry it rewrites. */
  source,
  text: z.string().trim().min(1).max(DOCUMENT_LIMITS.bullet),
});

export const TailoredExperienceSchema = z.strictObject({
  source,
  company: shortText,
  title: shortText,
  location: shortText,
  startDate: dateText,
  endDate: dateText,
  bullets: z.array(TailoredBulletSchema).max(DOCUMENT_LIMITS.bulletsPerEntry),
});

export const TailoredEducationSchema = z.strictObject({
  source,
  institution: shortText,
  degree: shortText,
  grade: shortText,
  startDate: dateText,
  endDate: dateText,
});

export const TailoredSkillSchema = z.strictObject({
  source,
  name: shortText.min(1),
});

export const TailoredCvSchema = z.strictObject({
  summary: z.string().trim().max(DOCUMENT_LIMITS.summary),
  experience: z.array(TailoredExperienceSchema).max(DOCUMENT_LIMITS.experience),
  education: z.array(TailoredEducationSchema).max(DOCUMENT_LIMITS.education),
  skills: z.array(TailoredSkillSchema).max(DOCUMENT_LIMITS.skills),
});

export type TailoredCv = z.output<typeof TailoredCvSchema>;

export const CoverLetterSchema = z.strictObject({
  paragraphs: z
    .array(z.string().trim().min(1).max(DOCUMENT_LIMITS.paragraph))
    .min(1)
    .max(DOCUMENT_LIMITS.paragraphs),
});

export type CoverLetter = z.output<typeof CoverLetterSchema>;

/** What a document stores: the editable source the user tweaks and the PDF is rendered from. */
export const DocumentContentSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("cv"), cv: TailoredCvSchema }),
  z.strictObject({ kind: z.literal("cover-letter"), letter: CoverLetterSchema }),
]);

export type DocumentContent = z.output<typeof DocumentContentSchema>;

/** Codes of the checks a document must pass against its profile. Messages live in the renderer and main i18n. */
export const DOCUMENT_ISSUE_CODES = [
  "source-missing",
  "source-repeated",
  "field-mismatch",
  "skill-name",
  "numbers-not-in-source",
  "numbers-not-in-profile",
] as const;
export type DocumentIssueCode = (typeof DOCUMENT_ISSUE_CODES)[number];

/** One failed check. `path` locates it in the document, e.g. `experience.1.bullets.0`. */
export interface DocumentIssue {
  code: DocumentIssueCode;
  path: string;
}

const NUMBER_PATTERN = /\d+(?:[.,]\d+)*/g;
const THOUSANDS_GROUPED = /^(\d{1,3}(?:[.,]\d{3})+)([.,]\d+)?$/;

/**
 * One spelling per number, whatever the language writes it in: "1,000" (en) and "1.000" (it) are
 * both 1000, and "3,5" (it) equals "3.5" (en). Only the separators differ between languages.
 */
function canonicalNumber(token: string): string {
  const grouped = THOUSANDS_GROUPED.exec(token);
  if (grouped) {
    const integer = (grouped[1] ?? "").replace(/[.,]/g, "");
    const decimal = grouped[2];
    return decimal ? `${integer}.${decimal.slice(1)}` : integer;
  }
  return token.replace(",", ".");
}

function numbersOf(text: string): Set<string> {
  return new Set((text.match(NUMBER_PATTERN) ?? []).map(canonicalNumber));
}

/** True when `text` has a number that `allowed` does not contain. */
function hasNumberOutside(text: string, allowed: Set<string>): boolean {
  for (const number of numbersOf(text)) {
    if (!allowed.has(number)) return true;
  }
  return false;
}

/**
 * Every text of the profile in one string: a number in a document is checked against it. Only the
 * fields a CV or letter can show are read.
 */
export function profileText(profile: Profile): string {
  const parts: string[] = [profile.headline, profile.summary];
  for (const item of profile.experience) {
    parts.push(
      item.company,
      item.title,
      item.location,
      item.startDate,
      item.endDate,
      ...item.bullets,
    );
  }
  for (const item of profile.education) {
    parts.push(item.institution, item.degree, item.grade, item.startDate, item.endDate);
  }
  for (const item of profile.skills) {
    parts.push(item.name, item.level, ...item.aliases);
  }
  for (const item of profile.languages) {
    parts.push(item.name, item.level);
  }
  for (const item of profile.certifications) {
    parts.push(item.name, item.issuer, item.date);
  }
  return parts.join("\n");
}

/** Marks a profile item as used; a second use in the same list is an issue. */
function claim(used: Set<number>, index: number, path: string, issues: DocumentIssue[]): boolean {
  if (used.has(index)) {
    issues.push({ code: "source-repeated", path });
    return false;
  }
  used.add(index);
  return true;
}

/**
 * The checks a tailored CV must pass: every entry points at a profile item; employers, titles,
 * locations, dates, institutions, degrees and fields equal the profile's verbatim; each bullet
 * rewrites a source bullet and adds no number that the source lacks; skill names are the profile's
 * name or one of its aliases; the summary adds no number the profile lacks.
 */
export function validateTailoredCv(cv: TailoredCv, profile: Profile): DocumentIssue[] {
  const issues: DocumentIssue[] = [];
  const profileNumbers = numbersOf(profileText(profile));
  if (hasNumberOutside(cv.summary, profileNumbers)) {
    issues.push({ code: "numbers-not-in-profile", path: "summary" });
  }

  const usedExperience = new Set<number>();
  cv.experience.forEach((entry, index) => {
    const path = `experience.${index}`;
    const item = profile.experience[entry.source];
    if (!item) {
      issues.push({ code: "source-missing", path });
      return;
    }
    if (!claim(usedExperience, entry.source, path, issues)) return;
    const matches =
      entry.company === item.company &&
      entry.title === item.title &&
      entry.location === item.location &&
      entry.startDate === item.startDate &&
      entry.endDate === item.endDate;
    if (!matches) {
      issues.push({ code: "field-mismatch", path });
    }
    entry.bullets.forEach((bullet, bulletIndex) => {
      const bulletPath = `${path}.bullets.${bulletIndex}`;
      const sourceBullet = item.bullets[bullet.source];
      if (sourceBullet === undefined) {
        issues.push({ code: "source-missing", path: bulletPath });
        return;
      }
      if (hasNumberOutside(bullet.text, numbersOf(sourceBullet))) {
        issues.push({ code: "numbers-not-in-source", path: bulletPath });
      }
    });
  });

  const usedEducation = new Set<number>();
  cv.education.forEach((entry, index) => {
    const path = `education.${index}`;
    const item = profile.education[entry.source];
    if (!item) {
      issues.push({ code: "source-missing", path });
      return;
    }
    if (!claim(usedEducation, entry.source, path, issues)) return;
    const matches =
      entry.institution === item.institution &&
      entry.degree === item.degree &&
      entry.grade === item.grade &&
      entry.startDate === item.startDate &&
      entry.endDate === item.endDate;
    if (!matches) {
      issues.push({ code: "field-mismatch", path });
    }
  });

  const usedSkills = new Set<number>();
  cv.skills.forEach((entry, index) => {
    const path = `skills.${index}`;
    const item = profile.skills[entry.source];
    if (!item) {
      issues.push({ code: "source-missing", path });
      return;
    }
    if (!claim(usedSkills, entry.source, path, issues)) return;
    if (entry.name !== item.name && !item.aliases.includes(entry.name)) {
      issues.push({ code: "skill-name", path });
    }
  });

  return issues;
}

/** The checks a cover letter must pass: no paragraph adds a number the profile lacks. */
export function validateCoverLetter(letter: CoverLetter, profile: Profile): DocumentIssue[] {
  const profileNumbers = numbersOf(profileText(profile));
  const issues: DocumentIssue[] = [];
  letter.paragraphs.forEach((paragraph, index) => {
    if (hasNumberOutside(paragraph, profileNumbers)) {
      issues.push({ code: "numbers-not-in-profile", path: `paragraphs.${index}` });
    }
  });
  return issues;
}

/** Validates a document against the profile it was made from (or is being edited against). */
export function validateDocument(content: DocumentContent, profile: Profile): DocumentIssue[] {
  return content.kind === "cv"
    ? validateTailoredCv(content.cv, profile)
    : validateCoverLetter(content.letter, profile);
}

/** A sentence is the run up to a full stop, "!" or "?" and the space after it. */
function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.trim() !== "");
}

/**
 * Brings an answer back to the profile's facts instead of throwing it away. Models drift in small
 * ways (a date written another way, a rounded number, a skill renamed); a rejected answer costs the
 * user a whole generation, so what can be set right from the profile is set right:
 * - employers, titles, locations, dates, institutions, degrees, grades and skill names are copied
 *   from the profile item the entry points at;
 * - an entry pointing at no profile item, or at one already used, is dropped;
 * - a bullet whose number is not in its source bullet becomes the source bullet's own text, and a
 *   bullet pointing at no source bullet is dropped;
 * - sentences of the summary and paragraphs of a letter with a number the profile lacks are dropped;
 * - entries keep the profile's order. Which experiences and degrees appear is the model's choice
 *   (the most relevant ones); nothing is added back.
 * Nothing is added that the profile does not state. What is left still goes through
 * `validateDocument`.
 */
export function repairDocument(content: DocumentContent, profile: Profile): DocumentContent {
  const profileNumbers = numbersOf(profileText(profile));
  if (content.kind === "cover-letter") {
    return {
      kind: "cover-letter",
      letter: {
        paragraphs: content.letter.paragraphs.filter(
          (paragraph) => !hasNumberOutside(paragraph, profileNumbers),
        ),
      },
    };
  }

  const cv = content.cv;
  const usedExperience = new Set<number>();
  const experience = cv.experience.flatMap((entry) => {
    const item = profile.experience[entry.source];
    if (!item || usedExperience.has(entry.source)) return [];
    usedExperience.add(entry.source);
    const bullets = entry.bullets.flatMap((bullet) => {
      const sourceBullet = item.bullets[bullet.source];
      if (sourceBullet === undefined) return [];
      const text = hasNumberOutside(bullet.text, numbersOf(sourceBullet))
        ? sourceBullet.trim()
        : bullet.text;
      return text === "" ? [] : [{ source: bullet.source, text }];
    });
    return [
      {
        source: entry.source,
        company: item.company,
        title: item.title,
        location: item.location,
        startDate: item.startDate,
        endDate: item.endDate,
        bullets,
      },
    ];
  });

  const usedEducation = new Set<number>();
  const education = cv.education.flatMap((entry) => {
    const item = profile.education[entry.source];
    if (!item || usedEducation.has(entry.source)) return [];
    usedEducation.add(entry.source);
    return [
      {
        source: entry.source,
        institution: item.institution,
        degree: item.degree,
        grade: item.grade,
        startDate: item.startDate,
        endDate: item.endDate,
      },
    ];
  });

  const usedSkills = new Set<number>();
  const skills = cv.skills.flatMap((entry) => {
    const item = profile.skills[entry.source];
    if (!item || usedSkills.has(entry.source)) return [];
    usedSkills.add(entry.source);
    const name =
      entry.name === item.name || item.aliases.includes(entry.name) ? entry.name : item.name;
    return [{ source: entry.source, name }];
  });

  // Entries keep the profile's order (newest first), whatever order the model chose.
  experience.sort((a, b) => a.source - b.source);
  education.sort((a, b) => a.source - b.source);

  const summary = sentencesOf(cv.summary)
    .filter((sentence) => !hasNumberOutside(sentence, profileNumbers))
    .join(" ");
  return { kind: "cv", cv: { summary, experience, education, skills } };
}
