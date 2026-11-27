// protects=the rendered document is a plain single-column page whose every user value is escaped, with the profile's contact line and the labels passed in, stored dates shown as a CV writes them, and the letter opens with its greeting, the profile's links as escaped http(s) links, and a paper-sheet look on screen only;
// fails_when=the headline is lost or the look differs from the exported CV, a value from the profile or the document reaches the page unescaped, a table or script is emitted, the headings or language attribute are not the ones given, or a section with no content still gets a heading;
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
  present: "Present",
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
    expect(html).toContain("Milano | maria@example.com");
    expect(html).toContain("<h2>Experience</h2>");
    expect(html).toContain('<h3>Senior &lt;Engineer&gt; — <span class="company">Acme</span></h3>');
    expect(html).toContain("<li>Cut &quot;billing&quot; latency by 40%</li>");
    // The skills are one line of words, after the summary and before the experience.
    expect(html).toContain("<p>TypeScript</p>");
    expect(html.indexOf("<h2>Skills</h2>")).toBeLessThan(html.indexOf("<h2>Experience</h2>"));
    expect(html).toContain("<title>Maria &lt;Rossi&gt; — CV</title>");
  });

  it("shows stored dates as a CV writes them, and an ongoing end in the document's language", () => {
    const html = renderDocumentHtml(
      {
        kind: "cv",
        cv: {
          summary: "",
          experience: [
            {
              ...cvContent.cv.experience[0]!,
              startDate: "2021-03",
              endDate: "present",
              bullets: [],
            },
          ],
          education: [
            {
              source: 0,
              institution: "Politecnico",
              degree: "MSc in Computer Science",
              grade: "110/110",
              startDate: "2012",
              endDate: "2014",
            },
          ],
          skills: [],
        },
      },
      contact,
      { ...labels, present: "Presente" },
      "it",
    );
    expect(html).toContain("Milano | 03/2021 – Presente");
    expect(html).toContain("<h3>MSc in Computer Science</h3>");
    expect(html).toContain("Politecnico | 110/110 | 2012 – 2014");
  });

  it("shows the profile's headline under the name, and the same look as the exported CV (navy rules, small capitals)", () => {
    const html = renderDocumentHtml(cvContent, contact, labels, "en", [], " Backend engineer ");
    expect(html).toContain('<p class="headline">Backend engineer</p>');
    expect(html).toContain("text-transform: uppercase");
    expect(html).toContain("#1b2a49");
    expect(renderDocumentHtml(cvContent, contact, labels, "en")).not.toContain('class="headline"');
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
    // A letter is set larger than a CV.
    expect(html).toContain('<body class="letter">');
    expect(renderDocumentHtml(cvContent, contact, labels, "en")).toContain("<body>");
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

  it("shows the profile's links as clickable addresses under the contact line, in a CV and a letter, escaped and limited to http(s)", () => {
    const links = [
      { label: "Portfolio", url: "https://maria.example/work?a=1&b=2" },
      { label: "", url: "https://github.com/maria" },
      { label: "Bad", url: "javascript:alert(1)" },
    ];
    const letter: DocumentContent = {
      kind: "cover-letter",
      letter: { paragraphs: ["Hello."] },
    };
    for (const content of [cvContent, letter]) {
      const html = renderDocumentHtml(content, contact, labels, "en", links);
      // An address shows without its scheme, escaped, and stays a link.
      expect(html).toContain(
        '<a href="https://maria.example/work?a=1&amp;b=2">maria.example/work?a=1&amp;b=2</a>',
      );
      expect(html).toContain('<a href="https://github.com/maria">github.com/maria</a>');
      expect(html).not.toContain("javascript:");
    }
    // Without links nothing is added.
    expect(renderDocumentHtml(cvContent, contact, labels, "en")).not.toContain("<a ");
  });

  it("shows the page as a sheet of paper on screen (the preview) and prints without it", () => {
    const html = renderDocumentHtml(cvContent, contact, labels, "en");
    expect(html).toContain("@media screen");
    expect(html).toContain("@page { size: A4");
  });
});
