import {
  contactLine,
  joinPresent,
  period,
  renderCvPage,
  type CvModel,
  type CvSection,
  type DocumentLabels,
} from "../documents/render";
import type { Profile } from "./schema";

export { shortUrl } from "../documents/render";
export type { CvEntry, CvModel, CvSection } from "../documents/render";

/** Headings and words of an exported CV, in the CV's language. The caller translates them. */
export interface CvLabels extends DocumentLabels {
  courses: string;
  languages: string;
  certifications: string;
  /** The language level "native", e.g. "Native speaker". */
  native: string;
}

/**
 * The whole profile as a CV, nothing left out and nothing added: the headline, summary, skills,
 * every experience with its bullets, education and courses apart, certifications and languages.
 * Section titles, dates ("Present") and the "native" level follow the CV's language; the profile's
 * own text stays as the user wrote it. Empty parts are left out.
 */
export function profileToCv(profile: Profile, labels: CvLabels): CvModel {
  const sections: CvSection[] = [];
  const summary = profile.summary.trim();
  if (summary !== "") sections.push({ heading: labels.summary, kind: "text", text: summary });

  if (profile.skills.length > 0) {
    sections.push({
      heading: labels.skills,
      kind: "items",
      items: profile.skills.map((skill) => skill.name),
    });
  }

  if (profile.experience.length > 0) {
    sections.push({
      heading: labels.experience,
      kind: "entries",
      entries: profile.experience.map((item) => ({
        title: item.title,
        company: item.company,
        meta: joinPresent([item.location, period(item.startDate, item.endDate, labels)], " | "),
        bullets: item.bullets.filter((bullet) => bullet.trim() !== ""),
      })),
    });
  }

  for (const [category, heading] of [
    ["degree", labels.education],
    ["course", labels.courses],
  ] as const) {
    const entries = profile.education
      .filter((item) => item.category === category)
      .map((item) => ({
        title: item.degree,
        company: "",
        meta: joinPresent(
          [item.institution, item.grade, period(item.startDate, item.endDate, labels)],
          " | ",
        ),
        bullets: [],
      }));
    if (entries.length > 0) sections.push({ heading, kind: "entries", entries });
  }

  if (profile.certifications.length > 0) {
    sections.push({
      heading: labels.certifications,
      kind: "entries",
      entries: profile.certifications.map((item) => ({
        title: item.name,
        company: "",
        meta: joinPresent([item.issuer, period(item.date, "", labels)], " | "),
        bullets: [],
      })),
    });
  }

  if (profile.languages.length > 0) {
    sections.push({
      heading: labels.languages,
      kind: "pairs",
      pairs: profile.languages.map((item) => ({
        label: item.name,
        value: item.level === "native" ? labels.native : item.level,
      })),
    });
  }

  return {
    name: profile.contact.fullName,
    headline: profile.headline.trim(),
    contact: contactLine(profile.contact),
    links: profile.links.filter((link) => /^https?:\/\//i.test(link.url)),
    sections,
  };
}

/** The CV model as a plain, single-column HTML page: the PDF is this page printed. */
export function renderCvHtml(cv: CvModel, language: string, title: string): string {
  return renderCvPage(cv, language, title);
}
