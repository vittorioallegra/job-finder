// protects=the document validator accepts a tailored CV and letter that use only the profile's own facts, and reports every employer, title, date, degree, skill name, source index and number that the profile does not support; in an Italian document the same facts pass, with each number read the same in en and it spelling, and translated employers or titles fail;
// fails_when=an employer, title, date, institution, degree or field that differs from the profile passes, a skill name outside the profile's names and aliases passes, a bullet with a number its source bullet lacks passes, a number the profile lacks in the summary or a paragraph passes, an out-of-range or repeated profile item passes, "1.000" and "1,000" or "3,5" and "3.5" are read as different numbers, or a translated title passes;
// no_claim=the validator does not judge style, length of prose, the language itself or whether the wording is accurate beyond these facts; prose that paraphrases the profile without new numbers is not checked further, and number words such as "tre" are not read;
import { describe, expect, it } from "vitest";
import { emptyProfile, type Profile } from "../profile/schema";
import {
  DocumentContentSchema,
  validateCoverLetter,
  validateDocument,
  validateTailoredCv,
  type TailoredCv,
} from "./schema";

/** The profile with thousands and decimal numbers, spelled the way an English CV writes them. */
function englishNumbersProfile(): Profile {
  const base = profile();
  return {
    ...base,
    summary: "Ten years building APIs for 1,000 users.",
    experience: [
      { ...base.experience[0]!, bullets: ["Served 1,000 users at 3.5 seconds p95"] },
      base.experience[1]!,
    ],
  };
}

function profile(): Profile {
  return {
    ...emptyProfile(),
    headline: "Backend Engineer",
    summary: "Ten years building APIs.",
    experience: [
      {
        company: "Acme",
        title: "Senior Engineer",
        location: "Milano",
        startDate: "2019",
        endDate: "2024",
        bullets: ["Cut latency by 40% on the billing API", "Led a team of 5 engineers"],
      },
      {
        company: "Globex",
        title: "Engineer",
        location: "Roma",
        startDate: "2015",
        endDate: "2019",
        bullets: ["Shipped the mobile backend"],
      },
    ],
    education: [
      {
        institution: "Politecnico di Milano",
        degree: "MSc",
        field: "Computer Science",
        startDate: "2011",
        endDate: "2013",
      },
    ],
    skills: [
      { name: "TypeScript", level: "expert", aliases: ["TS"] },
      { name: "Go", level: "", aliases: [] },
    ],
  };
}

/** A CV that uses the profile exactly, with one rewritten bullet. */
function cv(overrides: Partial<TailoredCv> = {}): TailoredCv {
  return {
    summary: "Backend engineer with a decade of API work.",
    experience: [
      {
        source: 0,
        company: "Acme",
        title: "Senior Engineer",
        location: "Milano",
        startDate: "2019",
        endDate: "2024",
        bullets: [{ source: 0, text: "Reduced billing API latency by 40%" }],
      },
    ],
    education: [
      {
        source: 0,
        institution: "Politecnico di Milano",
        degree: "MSc",
        field: "Computer Science",
        startDate: "2011",
        endDate: "2013",
      },
    ],
    skills: [{ source: 0, name: "TS" }],
    ...overrides,
  };
}

function codes(issues: { code: string }[]): string[] {
  return issues.map((issue) => issue.code);
}

describe("validateTailoredCv", () => {
  it("accepts a CV that uses the profile's own facts, aliases included", () => {
    expect(validateTailoredCv(cv(), profile())).toEqual([]);
  });

  it("reports an employer, title, date or degree that differs from the profile", () => {
    const wrongEmployer = cv({
      experience: [{ ...cv().experience[0]!, company: "Initech" }],
    });
    const wrongDate = cv({
      education: [{ ...cv().education[0]!, endDate: "2014" }],
    });
    expect(codes(validateTailoredCv(wrongEmployer, profile()))).toEqual(["field-mismatch"]);
    expect(codes(validateTailoredCv(wrongDate, profile()))).toEqual(["field-mismatch"]);
  });

  it("reports a skill name the profile does not list", () => {
    const invented = cv({ skills: [{ source: 0, name: "Rust" }] });
    expect(codes(validateTailoredCv(invented, profile()))).toEqual(["skill-name"]);
  });

  it("reports a bullet that adds a number its source bullet lacks", () => {
    const inflated = cv({
      experience: [
        {
          ...cv().experience[0]!,
          bullets: [{ source: 0, text: "Reduced billing API latency by 60%" }],
        },
      ],
    });
    const issues = validateTailoredCv(inflated, profile());
    expect(issues).toEqual([{ code: "numbers-not-in-source", path: "experience.0.bullets.0" }]);
  });

  it("reports a summary number that the profile does not contain", () => {
    const issues = validateTailoredCv(cv({ summary: "12 years of API work." }), profile());
    expect(issues).toEqual([{ code: "numbers-not-in-profile", path: "summary" }]);
  });

  it("reports a source index that points to no profile item, and a profile item used twice", () => {
    const missing = cv({ experience: [{ ...cv().experience[0]!, source: 9 }] });
    const repeated = cv({
      experience: [cv().experience[0]!, { ...cv().experience[0]!, bullets: [] }],
    });
    expect(codes(validateTailoredCv(missing, profile()))).toEqual(["source-missing"]);
    expect(codes(validateTailoredCv(repeated, profile()))).toEqual(["source-repeated"]);
  });

  it("reports a bullet that points to no source bullet", () => {
    const bad = cv({
      experience: [{ ...cv().experience[0]!, bullets: [{ source: 5, text: "Did things" }] }],
    });
    expect(validateTailoredCv(bad, profile())).toEqual([
      { code: "source-missing", path: "experience.0.bullets.0" },
    ]);
  });
});

describe("validateCoverLetter", () => {
  it("accepts paragraphs whose numbers all come from the profile", () => {
    const letter = { paragraphs: ["I led a team of 5 engineers at Acme."] };
    expect(validateCoverLetter(letter, profile())).toEqual([]);
  });

  it("reports a paragraph with a number the profile lacks", () => {
    const letter = { paragraphs: ["Fine.", "I have 20 years of experience."] };
    expect(validateCoverLetter(letter, profile())).toEqual([
      { code: "numbers-not-in-profile", path: "paragraphs.1" },
    ]);
  });
});

describe("DocumentContentSchema and validateDocument", () => {
  it("accepts both kinds and rejects an unknown kind", () => {
    expect(DocumentContentSchema.safeParse({ kind: "cv", cv: cv() }).success).toBe(true);
    expect(
      DocumentContentSchema.safeParse({ kind: "cover-letter", letter: { paragraphs: ["Hi."] } })
        .success,
    ).toBe(true);
    expect(DocumentContentSchema.safeParse({ kind: "resume", cv: cv() }).success).toBe(false);
  });

  it("checks each content against its own rules", () => {
    const issues = validateDocument(
      { kind: "cover-letter", letter: { paragraphs: ["I have 99 reasons."] } },
      profile(),
    );
    expect(issues).toEqual([{ code: "numbers-not-in-profile", path: "paragraphs.0" }]);
  });
});

describe("validation across languages", () => {
  it("accepts an Italian letter whose numbers are the profile's, written with Italian separators", () => {
    const letter = { paragraphs: ["Ho servito 1.000 utenti con una latenza di 3,5 secondi."] };
    expect(validateCoverLetter(letter, englishNumbersProfile())).toEqual([]);
  });

  it("accepts an Italian CV bullet with the same numbers, and reports one number more", () => {
    const profileIt = englishNumbersProfile();
    const bullets = (text: string) =>
      cv({
        summary: "Ingegnere backend.",
        experience: [
          {
            ...cv().experience[0]!,
            bullets: [{ source: 0, text }],
          },
        ],
      });

    expect(validateTailoredCv(bullets("Serviti 1.000 utenti in 3,5 secondi"), profileIt)).toEqual(
      [],
    );
    expect(codes(validateTailoredCv(bullets("Serviti 1.000 utenti in 2 anni"), profileIt))).toEqual(
      ["numbers-not-in-source"],
    );
  });

  it("reads 1.000 and 1,000 as one number, and a different thousands value as another", () => {
    const letter = (paragraph: string) => ({ paragraphs: [paragraph] });
    expect(validateCoverLetter(letter("Su 1.000 casi."), englishNumbersProfile())).toEqual([]);
    expect(codes(validateCoverLetter(letter("Su 1.001 casi."), englishNumbersProfile()))).toEqual([
      "numbers-not-in-profile",
    ]);
  });

  it("keeps employers, titles, dates and institutions verbatim, whatever the document language", () => {
    const translatedTitle = cv({
      experience: [{ ...cv().experience[0]!, title: "Ingegnere Senior" }],
    });
    expect(codes(validateTailoredCv(translatedTitle, profile()))).toEqual(["field-mismatch"]);

    const verbatimEmployer = cv({
      summary: "Ingegnere backend con un decennio di lavoro sulle API.",
    });
    expect(validateTailoredCv(verbatimEmployer, profile())).toEqual([]);
  });
});
