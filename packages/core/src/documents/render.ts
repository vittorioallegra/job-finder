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

const PRINT_STYLE = [
  "@page { size: A4; margin: 16mm; }",
  "body { margin: 0; color: #111; font-family: -apple-system, 'Segoe UI', Arial, sans-serif; font-size: 10.5pt; line-height: 1.4; }",
  "h1 { margin: 0 0 2px; font-size: 20pt; }",
  "h2 { margin: 14px 0 6px; padding-bottom: 2px; border-bottom: 1px solid #999; font-size: 12pt; }",
  "h3 { margin: 8px 0 1px; font-size: 10.5pt; }",
  "p { margin: 2px 0; }",
  "ul { margin: 2px 0 0 18px; padding: 0; }",
  "li { margin: 1px 0; }",
  ".contact, .meta { color: #444; }",
  ".links a { color: #0b4f9c; text-decoration: none; }",
  // On screen (the preview) the page shows as a sheet of paper; printing ignores this block.
  "@media screen { html { background: #d9d9d9; } body { box-sizing: border-box; width: 210mm; min-height: 297mm; margin: 0 auto; padding: 16mm; background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.25); } }",
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

function joinPresent(parts: string[], separator: string): string {
  return parts.filter((part) => part !== "").join(separator);
}

/** A stored date as a CV shows it: `2021-03` as 03/2021, `present` in the document's language. */
function showDate(value: string, labels: DocumentLabels): string {
  const parsed = parseProfileDate(value);
  if (parsed === null) return value;
  if (parsed === PRESENT) return labels.present;
  return parsed.month === null
    ? String(parsed.year)
    : `${String(parsed.month).padStart(2, "0")}/${parsed.year}`;
}

function dateRange(start: string, end: string, labels: DocumentLabels): string {
  return joinPresent([showDate(start, labels), showDate(end, labels)], " – ");
}

function contactLine(contact: Profile["contact"]): string {
  return joinPresent([contact.email, contact.phone, contact.location], " · ");
}

/**
 * The profile's links (portfolio, LinkedIn, GitHub), each as its label and its address, so a form
 * that asks for a portfolio is answered by the document too. Only http and https addresses are
 * shown, as links.
 */
function linksLine(links: Profile["links"]): string {
  const shown = links.filter((link) => /^https?:\/\//i.test(link.url));
  if (shown.length === 0) return "";
  const items = shown.map((link) => {
    const url = escapeHtml(link.url);
    const text = link.label === "" ? url : `${escapeHtml(link.label)}: ${url}`;
    return `<a href="${url}">${text}</a>`;
  });
  return `<p class="contact links">${items.join(" · ")}</p>`;
}

function cvBody(cv: TailoredCv, labels: DocumentLabels): string {
  const sections: string[] = [];
  if (cv.summary !== "") {
    sections.push(
      `<section><h2>${escapeHtml(labels.summary)}</h2><p>${escapeHtml(cv.summary)}</p></section>`,
    );
  }
  if (cv.experience.length > 0) {
    const entries = cv.experience.map((entry) => {
      const heading = joinPresent([entry.title, entry.company], " — ");
      const meta = joinPresent(
        [entry.location, dateRange(entry.startDate, entry.endDate, labels)],
        " · ",
      );
      const bullets =
        entry.bullets.length > 0
          ? `<ul>${entry.bullets.map((bullet) => `<li>${escapeHtml(bullet.text)}</li>`).join("")}</ul>`
          : "";
      return `<article><h3>${escapeHtml(heading)}</h3>${meta ? `<p class="meta">${escapeHtml(meta)}</p>` : ""}${bullets}</article>`;
    });
    sections.push(
      `<section><h2>${escapeHtml(labels.experience)}</h2>${entries.join("")}</section>`,
    );
  }
  if (cv.education.length > 0) {
    const entries = cv.education.map((entry) => {
      const heading = entry.degree;
      const meta = joinPresent(
        [entry.institution, entry.grade, dateRange(entry.startDate, entry.endDate, labels)],
        " · ",
      );
      return `<article><h3>${escapeHtml(heading)}</h3>${meta ? `<p class="meta">${escapeHtml(meta)}</p>` : ""}</article>`;
    });
    sections.push(`<section><h2>${escapeHtml(labels.education)}</h2>${entries.join("")}</section>`);
  }
  if (cv.skills.length > 0) {
    const items = cv.skills.map((skill) => `<li>${escapeHtml(skill.name)}</li>`).join("");
    sections.push(`<section><h2>${escapeHtml(labels.skills)}</h2><ul>${items}</ul></section>`);
  }
  return sections.join("");
}

/**
 * Renders a document as a plain, single-column HTML page: real headings, lists and paragraphs, no
 * tables or layout tricks, so applicant tracking systems read it. The printed PDF is this page.
 */
export function renderDocumentHtml(
  content: DocumentContent,
  contact: Profile["contact"],
  labels: DocumentLabels,
  language: string,
  links: Profile["links"] = [],
): string {
  const name = contact.fullName;
  const title = content.kind === "cv" ? labels.cvTitle : labels.coverLetterTitle;
  const header = [
    `<h1>${escapeHtml(name)}</h1>`,
    contactLine(contact) ? `<p class="contact">${escapeHtml(contactLine(contact))}</p>` : "",
    linksLine(links),
  ].join("");
  const body =
    content.kind === "cv"
      ? cvBody(content.cv, labels)
      : [
          `<p>${escapeHtml(labels.greeting)}</p>`,
          ...content.letter.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
        ].join("");
  return [
    "<!doctype html>",
    `<html lang="${escapeHtml(language)}">`,
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeHtml(joinPresent([name, title], " — "))}</title>`,
    `<style>${PRINT_STYLE}</style>`,
    "</head>",
    "<body>",
    `<header>${header}</header>`,
    `<main>${body}</main>`,
    "</body>",
    "</html>",
  ].join("");
}
