// protects=the rendered document is a plain single-column page whose every user value is escaped, with the profile's contact line and the labels passed in, and the letter opens with its greeting;
// fails_when=a value from the profile or the document reaches the page unescaped, a table or script is emitted, the headings or language attribute are not the ones given, or a section with no content still gets a heading;
// no_claim=the page is not checked in a PDF engine or an applicant tracking system; only its HTML structure and escaping are asserted;
import { describe, expect, it } from "vitest";
import { emptyProfile } from "../profile/schema";
import { renderDocumentHtml, escapeHtml, type DocumentLabels } from "./render";
import type { DocumentContent } from "./schema";

const labels: DocumentLabels = {
  cvTitle: "CV",
  coverLetterTitle: "Cover letter",
  summary: "Summary",
  experience: "Experience",
  education: "Education",
  skills: "Skills",
  greeting: "Dear hiring team,",
};

const contact = {
  fullName: "Maria <Rossi>",
  email: "maria@example.com",
  phone: "",
  location: "Milano",
};

const cvContent: DocumentContent = {
  kind: "cv",
  cv: {
    summary: "Backend & API work.",
    experience: [
      {
        source: 0,
        company: "Acme",
        title: "Senior <Engineer>",
        location: "Milano",
        startDate: "2019",
        endDate: "2024",
        bullets: [{ source: 0, text: 'Cut "billing" latency by 40%' }],
      },
    ],
    education: [],
    skills: [{ source: 0, name: "TypeScript" }],
  },
};

describe("renderDocumentHtml", () => {
  it("renders a CV as headings, lists and paragraphs, with the contact line and escaped values", () => {
    const html = renderDocumentHtml(cvContent, contact, labels, "en");

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<h1>Maria &lt;Rossi&gt;</h1>");
    expect(html).toContain("maria@example.com · Milano");
    expect(html).toContain("<h2>Experience</h2>");
    expect(html).toContain("<h3>Senior &lt;Engineer&gt; — Acme</h3>");
    expect(html).toContain("<li>Cut &quot;billing&quot; latency by 40%</li>");
    expect(html).toContain("<li>TypeScript</li>");
    expect(html).toContain("<title>Maria &lt;Rossi&gt; — CV</title>");
  });

  it("omits the headings of sections with no content", () => {
    const html = renderDocumentHtml(cvContent, contact, labels, "en");
    expect(html).not.toContain("<h2>Education</h2>");
  });

  it("uses no table, script or inline event handler", () => {
    const html = renderDocumentHtml(cvContent, contact, labels, "en");
    expect(html).not.toMatch(/<table|<script|\son[a-z]+=/i);
  });

  it("renders a cover letter with its greeting and paragraphs, in the language given", () => {
    const letter: DocumentContent = {
      kind: "cover-letter",
      letter: { paragraphs: ["I build APIs.", "<img src=x onerror=alert(1)>"] },
    };
    const html = renderDocumentHtml(letter, contact, labels, "it");

    expect(html).toContain('<html lang="it">');
    expect(html).toContain("<title>Maria &lt;Rossi&gt; — Cover letter</title>");
    expect(html).toContain("<p>Dear hiring team,</p>");
    expect(html).toContain("<p>&lt;img src=x onerror=alert(1)&gt;</p>");
    expect(html).not.toContain("<img");
  });

  it("leaves the contact line out when no contact detail is filled in", () => {
    const empty = { ...emptyProfile().contact, fullName: "Maria" };
    expect(renderDocumentHtml(cvContent, empty, labels, "en")).not.toContain('class="contact"');
  });
});

describe("escapeHtml", () => {
  it("escapes the characters that can open a tag or close an attribute", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
