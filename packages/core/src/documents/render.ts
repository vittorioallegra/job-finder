import { PRESENT, parseProfileDate, type Profile } from "../profile/schema";
import type { DocumentContent, TailoredCv } from "./schema";

/** Headings and titles of a rendered document, in the document's language (the caller translates them). */
export interface DocumentLabels {
  cvTitle: string;
  coverLetterTitle: string;
  summary: string;
  experience: string;
  education: string;
  skills: string;
  /** The opening line of the cover letter, e.g. "Dear hiring team,". */
  greeting: string;
  /** The end date of a role or course still going on, e.g. "Present". */
  present: string;
}

/** One entry of a CV: a heading, a line of details and bullets. */
export interface CvEntry {
  title: string;
  /** Shown after the title, in the accent colour: the employer of a role. */
  company: string;
  /** Place, school, dates: one line, parts told apart by " | ". */
  meta: string;
  bullets: string[];
}

/** One section of a CV: a heading and a paragraph, entries, a list of words or labelled facts. */
export type CvSection =
  | { heading: string; kind: "text"; text: string }
  | { heading: string; kind: "entries"; entries: CvEntry[] }
  | { heading: string; kind: "items"; items: string[] }
  | { heading: string; kind: "pairs"; pairs: { label: string; value: string }[] };

/** The top of a CV or a letter: who it is from and how to reach them. */
export interface PageHeader {
  name: string;
  headline: string;
  /** Place, phone and email on one line, told apart by " | ". */
  contact: string;
  links: { label: string; url: string }[];
}

/** A CV as plain structure, shared by the PDF page and the Word file so the two always match. */
export interface CvModel extends PageHeader {
  sections: CvSection[];
}

/**
 * The look of every CV and letter the app makes: one dense A4 page where it can be, a navy name
 * and rules, small capitals for the section titles, and a muted line for places and dates. Plain
 * single column.
 */
export const PRINT_STYLE = [
  "@page { size: A4; margin: 13mm 15mm; }",
  "body { margin: 0; color: #1f2937; font-family: Lato, -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; font-size: 8.8pt; line-height: 1.32; }",
  "h1 { margin: 0; color: #1b2a49; font-size: 20pt; line-height: 1.1; }",
  ".headline { margin: 3px 0 0; color: #4a5568; font-size: 10pt; font-weight: 700; }",
  ".contact { margin: 3px 0 0; color: #4b5563; font-size: 8.4pt; }",
  ".contact a { color: #4b5563; text-decoration: none; }",
  "h2 { margin: 11px 0 5px; padding-bottom: 2px; border-bottom: 1.2px solid #1b2a49; color: #1b2a49; font-size: 9.6pt; letter-spacing: 0.05em; text-transform: uppercase; break-after: avoid; }",
  "h3 { margin: 0; font-size: 9pt; }",
  ".company { color: #2c5282; }",
  "article { margin: 6px 0 0; break-inside: avoid; }",
  ".meta { margin: 1px 0 2px; color: #6b7280; font-style: italic; }",
  "p { margin: 2px 0; }",
  // A letter is read, not scanned: larger text and room between paragraphs.
  ".letter main > p { margin: 0 0 9px; font-size: 10pt; line-height: 1.5; }",
  ".letter main > p:first-child { margin-top: 16px; }",
  "ul { margin: 2px 0 0 15px; padding: 0; }",
  "li { margin: 1.5px 0; }",
  ".pairs span { margin-right: 14px; white-space: nowrap; }",
  // On screen (the preview) the page shows as a sheet of paper; printing ignores this block.
  "@media screen { html { background: #d9d9d9; } body { box-sizing: border-box; width: 210mm; min-height: 297mm; margin: 0 auto; padding: 13mm 15mm; background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.25); } }",
].join("\n");

/** Escapes text for HTML. Every value that reaches the page goes through it. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function joinPresent(parts: string[], separator: string): string {
  return parts.filter((part) => part !== "").join(separator);
}

/** A stored date as a CV shows it: `2021-03` as 03/2021, `present` in the document's language. */
export function showDate(value: string, labels: DocumentLabels): string {
  const parsed = parseProfileDate(value);
  if (parsed === null) return value;
  if (parsed === PRESENT) return labels.present;
  return parsed.month === null
    ? String(parsed.year)
    : `${String(parsed.month).padStart(2, "0")}/${parsed.year}`;
}

export function dateRange(start: string, end: string, labels: DocumentLabels): string {
  return joinPresent([showDate(start, labels), showDate(end, labels)], " – ");
}

/** A period as a CV shows it: one date when it starts and ends in the same one ("2016", not "2016 – 2016"). */
export function period(start: string, end: string, labels: DocumentLabels): string {
  return start.trim() !== "" && start === end
    ? showDate(start, labels)
    : dateRange(start, end, labels);
}

/** An address as a CV shows it: no scheme, no "www.", no trailing slash. */
export function shortUrl(url: string): string {
  return url
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
}

/** Place, phone and email on one line: what a reader needs to reach the person. */
export function contactLine(contact: Profile["contact"]): string {
  return joinPresent([contact.location, contact.phone, contact.email], " | ");
}

function sectionHtml(section: CvSection): string {
  const heading = `<h2>${escapeHtml(section.heading)}</h2>`;
  if (section.kind === "text") {
    return `<section>${heading}<p>${escapeHtml(section.text)}</p></section>`;
  }
  if (section.kind === "items") {
    return `<section>${heading}<p>${section.items.map(escapeHtml).join(", ")}</p></section>`;
  }
  if (section.kind === "pairs") {
    const pairs = section.pairs.map(
      (pair) =>
        `<span><strong>${escapeHtml(pair.label)}</strong>${pair.value === "" ? "" : `: ${escapeHtml(pair.value)}`}</span>`,
    );
    return `<section>${heading}<p class="pairs">${pairs.join(" ")}</p></section>`;
  }
  const entries = section.entries.map((entry) => {
    const company =
      entry.company === "" ? "" : ` — <span class="company">${escapeHtml(entry.company)}</span>`;
    const meta = entry.meta === "" ? "" : `<p class="meta">${escapeHtml(entry.meta)}</p>`;
    const bullets =
      entry.bullets.length > 0
        ? `<ul>${entry.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>`
        : "";
    return `<article><h3>${escapeHtml(entry.title)}${company}</h3>${meta}${bullets}</article>`;
  });
  return `<section>${heading}${entries.join("")}</section>`;
}

/**
 * One page: the header (name, headline, contact line, links) and a body. Real headings, lists and
 * paragraphs, no tables, so applicant tracking systems read it; the PDF is this page printed. Every
 * value is escaped. The links are the profile's, limited to http and https.
 */
function renderPage(
  header: PageHeader,
  body: string,
  language: string,
  title: string,
  bodyClass = "",
): string {
  const links = header.links
    .filter((link) => /^https?:\/\//i.test(link.url))
    .map((link) => `<a href="${escapeHtml(link.url)}">${escapeHtml(shortUrl(link.url))}</a>`);
  const top = [
    `<h1>${escapeHtml(header.name)}</h1>`,
    header.headline === "" ? "" : `<p class="headline">${escapeHtml(header.headline)}</p>`,
    header.contact === "" ? "" : `<p class="contact">${escapeHtml(header.contact)}</p>`,
    links.length > 0 ? `<p class="contact">${links.join(" | ")}</p>` : "",
  ].join("");
  return [
    "<!doctype html>",
    `<html lang="${escapeHtml(language)}">`,
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeHtml(joinPresent([header.name, title], " — "))}</title>`,
    `<style>${PRINT_STYLE}</style>`,
    "</head>",
    bodyClass === "" ? "<body>" : `<body class="${bodyClass}">`,
    `<header>${top}</header>`,
    `<main>${body}</main>`,
    "</body>",
    "</html>",
  ].join("");
}

/** The CV model as a page: the profile exported as a CV. */
export function renderCvPage(cv: CvModel, language: string, title: string): string {
  return renderPage(cv, cv.sections.map(sectionHtml).join(""), language, title);
}

/** A tailored CV as the sections of a CV: profile summary, skills, experience, education. */
function tailoredSections(cv: TailoredCv, labels: DocumentLabels): CvSection[] {
  const sections: CvSection[] = [];
  if (cv.summary !== "") {
    sections.push({ heading: labels.summary, kind: "text", text: cv.summary });
  }
  if (cv.skills.length > 0) {
    sections.push({
      heading: labels.skills,
      kind: "items",
      items: cv.skills.map((skill) => skill.name),
    });
  }
  if (cv.experience.length > 0) {
    sections.push({
      heading: labels.experience,
      kind: "entries",
      entries: cv.experience.map((entry) => ({
        title: entry.title,
        company: entry.company,
        meta: joinPresent([entry.location, period(entry.startDate, entry.endDate, labels)], " | "),
        bullets: entry.bullets.map((bullet) => bullet.text),
      })),
    });
  }
  if (cv.education.length > 0) {
    sections.push({
      heading: labels.education,
      kind: "entries",
      entries: cv.education.map((entry) => ({
        title: entry.degree,
        company: "",
        meta: joinPresent(
          [entry.institution, entry.grade, period(entry.startDate, entry.endDate, labels)],
          " | ",
        ),
        bullets: [],
      })),
    });
  }
  return sections;
}

/**
 * Renders a document (a tailored CV or a cover letter) as a plain, single-column HTML page in the
 * same look as the profile's exported CV. The printed PDF is this page.
 */
export function renderDocumentHtml(
  content: DocumentContent,
  contact: Profile["contact"],
  labels: DocumentLabels,
  language: string,
  links: Profile["links"] = [],
  headline = "",
): string {
  const header: PageHeader = {
    name: contact.fullName,
    headline: headline.trim(),
    contact: contactLine(contact),
    links,
  };
  if (content.kind === "cv") {
    return renderPage(
      header,
      tailoredSections(content.cv, labels).map(sectionHtml).join(""),
      language,
      labels.cvTitle,
    );
  }
  const body = [
    `<p>${escapeHtml(labels.greeting)}</p>`,
    ...content.letter.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
  ].join("");
  return renderPage(header, body, language, labels.coverLetterTitle, "letter");
}
