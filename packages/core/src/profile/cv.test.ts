// protects=the profile becomes a CV with every part it holds and nothing it does not (education and courses apart, dates and the native level in the CV's language, only http links, empty parts left out), and the HTML page is a plain escaped single-column document with the headings in that language;
// fails_when=a part of the profile is dropped or invented, a course is listed as a degree, "Present" or "native" stay in the other language, a script reaches the page unescaped, or an empty section is printed;
// no_claim=how the PDF looks when printed and how Word shows the file, which only opening them shows;
import { describe, expect, it } from "vitest";
import { profileToCv, renderCvHtml, type CvLabels } from "./cv";
import { emptyProfile, type Profile } from "./schema";

const EN: CvLabels = {
  cvTitle: "CV",
  coverLetterTitle: "Cover letter",
  summary: "Summary",
  experience: "Experience",
  education: "Education",
  skills: "Skills",
  greeting: "Dear hiring team,",
  present: "Present",
  courses: "Courses",
  languages: "Languages",
  certifications: "Certifications",
  native: "Native speaker",
};
const IT: CvLabels = {
  ...EN,
  summary: "Profilo",
  experience: "Esperienza",
  education: "Istruzione",
  skills: "Competenze",
  present: "Presente",
  courses: "Corsi",
  languages: "Lingue",
  certifications: "Certificazioni",
  native: "Madrelingua",
};

function profile(): Profile {
  return {
    ...emptyProfile(),
    contact: {
      fullName: "Maria <Rossi>",
      email: "maria@example.com",
      phone: "+39 333",
      location: "Milano",
    },
    headline: "Backend engineer",
    summary: "Builds payment services.",
    experience: [
      {
        company: "Northwind",
        title: "Backend Engineer",
        location: "Milano",
        startDate: "2021-03",
        endDate: "present",
        bullets: ["Cut latency by 35%", "  "],
      },
    ],
    education: [
      {
        institution: "Politecnico",
        degree: "BSc Computer Engineering",
        category: "degree",
        grade: "110/110",
        startDate: "2014",
        endDate: "2017",
      },
      {
        institution: "Academy",
        degree: "Cloud bootcamp",
        category: "course",
        grade: "",
        startDate: "2022",
        endDate: "2022",
      },
    ],
    skills: [
      { name: "TypeScript", level: "", aliases: [] },
      { name: "PostgreSQL", level: "", aliases: [] },
    ],
    languages: [
      { name: "Italiano", level: "native" },
      { name: "English", level: "C1" },
    ],
    certifications: [{ name: "AWS SAA", issuer: "Amazon", date: "2023-05" }],
    links: [
      { label: "GitHub", url: "https://github.com/maria" },
      { label: "Bad", url: "javascript:alert(1)" },
    ],
  } as Profile;
}

describe("profile as a CV", () => {
  it("keeps every part of the profile, with dates and the native level in the CV's language", () => {
    const cv = profileToCv(profile(), IT);
    expect(cv.name).toBe("Maria <Rossi>");
    expect(cv.headline).toBe("Backend engineer");
    expect(cv.contact).toBe("Milano | +39 333 | maria@example.com");
    expect(cv.links).toEqual([{ label: "GitHub", url: "https://github.com/maria" }]);
    expect(cv.sections.map((section) => section.heading)).toEqual([
      "Profilo",
      "Competenze",
      "Esperienza",
      "Istruzione",
      "Corsi",
      "Certificazioni",
      "Lingue",
    ]);
    expect(cv.sections[2]).toMatchObject({
      kind: "entries",
      entries: [
        {
          title: "Backend Engineer",
          company: "Northwind",
          meta: "Milano | 03/2021 – Presente",
          bullets: ["Cut latency by 35%"],
        },
      ],
    });
    expect(cv.sections[3]).toMatchObject({
      entries: [
        {
          title: "BSc Computer Engineering",
          company: "",
          meta: "Politecnico | 110/110 | 2014 – 2017",
        },
      ],
    });
    // A course that starts and ends in the same year shows that year once.
    expect(cv.sections[4]).toMatchObject({
      entries: [{ title: "Cloud bootcamp", meta: "Academy | 2022" }],
    });
    expect(cv.sections[5]).toMatchObject({
      entries: [{ title: "AWS SAA", meta: "Amazon | 05/2023" }],
    });
    expect(cv.sections[6]).toMatchObject({
      kind: "pairs",
      pairs: [
        { label: "Italiano", value: "Madrelingua" },
        { label: "English", value: "C1" },
      ],
    });

    const english = profileToCv(profile(), EN);
    expect(english.sections[2]).toMatchObject({
      entries: [{ meta: "Milano | 03/2021 – Present" }],
    });
    expect(english.sections[6]).toMatchObject({
      pairs: [{ value: "Native speaker" }, { value: "C1" }],
    });
  });

  it("leaves out the parts the profile does not have", () => {
    const cv = profileToCv({ ...emptyProfile(), headline: "Only a headline" }, EN);
    expect(cv.sections).toEqual([]);
    expect(cv.links).toEqual([]);
    expect(cv.contact).toBe("");
  });

  it("renders a plain page with escaped text, the headings of the language, and no empty section", () => {
    const html = renderCvHtml(profileToCv(profile(), IT), "it", "CV");
    expect(html).toContain('<html lang="it">');
    expect(html).toContain("<h1>Maria &lt;Rossi&gt;</h1>");
    expect(html).not.toContain("<Rossi>");
    expect(html).toContain("<h2>Competenze</h2>");
    expect(html).toContain("<p>TypeScript, PostgreSQL</p>");
    expect(html).toContain('<h3>Backend Engineer — <span class="company">Northwind</span></h3>');
    expect(html).toContain("<strong>Italiano</strong>: Madrelingua");
    expect(html).toContain("text-transform: uppercase");
    // An address is shown without its scheme, and stays a link.
    expect(html).toContain('<a href="https://github.com/maria">github.com/maria</a>');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<table");
    const sparse = renderCvHtml(profileToCv({ ...emptyProfile(), headline: "x" }, EN), "en", "CV");
    expect(sparse).not.toContain("<h2>");
  });
});
