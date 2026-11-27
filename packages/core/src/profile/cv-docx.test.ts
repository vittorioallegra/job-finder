// protects=the Word file is a valid .docx (a zip with the document part) that reads back with real headings, bullet items and the text of the CV, in either language, and records the CV's name as author and the language tag;
// fails_when=the file is not a docx, a heading or bullet is lost, the text differs from the CV model, or the language tag is wrong;
// no_claim=how Word lays the file out on screen, which only opening it shows;
import JSZip from "jszip";
import mammoth from "mammoth";
import { describe, expect, it } from "vitest";
import { buildCvDocx } from "./cv-docx";
import { profileToCv, type CvLabels } from "./cv";
import { emptyProfile, type Profile } from "./schema";

const labels: CvLabels = {
  cvTitle: "CV",
  coverLetterTitle: "Cover letter",
  summary: "Summary",
  experience: "Experience",
  education: "Education",
  skills: "Skills",
  greeting: "",
  present: "Present",
  courses: "Courses",
  languages: "Languages",
  certifications: "Certifications",
  native: "Native speaker",
};

function profile(): Profile {
  return {
    ...emptyProfile(),
    contact: { fullName: "Maria Rossi", email: "maria@example.com", phone: "", location: "Milano" },
    headline: "Backend engineer",
    summary: "Builds payment services.",
    experience: [
      {
        company: "Northwind",
        title: "Backend Engineer",
        location: "Milano",
        startDate: "2021",
        endDate: "",
        bullets: ["Cut latency by 35%", "Moved reads to replicas"],
      },
    ],
    skills: [{ name: "TypeScript", level: "", aliases: [] }],
    links: [{ label: "GitHub", url: "https://github.com/maria" }],
  } as Profile;
}

describe("CV as a Word file", () => {
  it("is a docx that reads back with headings, bullets and the CV's text", async () => {
    const bytes = await buildCvDocx(profileToCv(profile(), labels), "it", "CV");

    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).toContain("word/document.xml");
    const documentXml = await zip.file("word/document.xml")!.async("string");
    expect(documentXml).toContain("Maria Rossi");
    const styles = await zip.file("word/styles.xml")!.async("string");
    expect(styles).toContain('w:lang w:val="it-IT"');
    const core = await zip.file("docProps/core.xml")!.async("string");
    expect(core).toContain("Maria Rossi");

    // Bold and italic runs are formatting, not structure: the headings and lists are what is checked.
    const html = (await mammoth.convertToHtml({ buffer: Buffer.from(bytes) })).value.replace(
      /<\/?(strong|em)>/g,
      "",
    );
    expect(html).toContain("<h1>Maria Rossi</h1>");
    expect(html).toContain("<h2>Experience</h2>");
    expect(html).toContain("<h3>Backend Engineer — Northwind</h3>");
    expect(html).toContain("<li>Cut latency by 35%</li>");
    expect(html).toContain("<li>Moved reads to replicas</li>");
    expect(html).toContain("<h2>Skills</h2>");
    expect(html).toContain("TypeScript");
    expect(html).toContain("https://github.com/maria");
  });

  it("tags a language without a regional tag by its own code, so a new language needs no change here", async () => {
    const bytes = await buildCvDocx(profileToCv(profile(), labels), "de", "CV");
    const styles = await (await JSZip.loadAsync(bytes)).file("word/styles.xml")!.async("string");
    expect(styles).toContain('w:lang w:val="de"');
  });

  it("tags an English CV as English", async () => {
    const bytes = await buildCvDocx(profileToCv(profile(), labels), "en", "CV");
    const styles = await (await JSZip.loadAsync(bytes)).file("word/styles.xml")!.async("string");
    expect(styles).toContain('w:lang w:val="en-GB"');
  });
});
