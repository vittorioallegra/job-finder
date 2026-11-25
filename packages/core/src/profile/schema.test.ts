// protects=the profile schema accepts an empty or complete profile and rejects malformed contact, link, skill, currency and oversized entries, and the scoring snapshot changes only with scoring fields, and an education entry has a category (degree or course) inferred from its title when missing;
// fails_when=a malformed email, non-HTTP link, blank skill name, lowercase currency or oversized list passes validation, or editing links or application defaults changes the scoring snapshot;
// no_claim=the schema does not check that an email or link is reachable, nor that dates are real calendar dates.
import { describe, expect, it } from "vitest";
import {
  emptyProfile,
  ProfileSchema,
  scoringSnapshot,
  applyCvExtraction,
  CvExtractionSchema,
  inferEducationCategory,
  type Profile,
} from "./schema";

function complete(): Profile {
  return {
    ...emptyProfile(),
    contact: { fullName: "Maria Rossi", email: "maria@example.com", phone: "", location: "Milano" },
    headline: "Backend Engineer",
    skills: [{ name: "TypeScript", level: "expert", aliases: ["TS"] }],
    links: [{ label: "GitHub", url: "https://github.com/example" }],
    applicationDefaults: {
      workAuthorization: [{ country: "IT", status: "citizen" }],
      noticePeriod: "1 month",
      salary: { amount: 60000, currency: "EUR", period: "year" },
      willingToRelocate: true,
      pronouns: "",
    },
    standardAnswers: [{ question: "Why us?", answer: "Good product." }],
  };
}

describe("ProfileSchema", () => {
  it("accepts an empty profile and a complete one", () => {
    expect(ProfileSchema.safeParse(emptyProfile()).success).toBe(true);
    expect(ProfileSchema.safeParse(complete()).success).toBe(true);
  });

  it("rejects a malformed email and a non-HTTP link", () => {
    const badEmail = { ...complete(), contact: { ...complete().contact, email: "maria at mail" } };
    const badLink = { ...complete(), links: [{ label: "x", url: "javascript:alert(1)" }] };
    expect(ProfileSchema.safeParse(badEmail).success).toBe(false);
    expect(ProfileSchema.safeParse(badLink).success).toBe(false);
  });

  it("rejects blank skill names, lowercase currency and oversized lists", () => {
    const blankSkill = { ...complete(), skills: [{ name: " ", level: "", aliases: [] }] };
    const lowerCurrency = {
      ...complete(),
      applicationDefaults: {
        ...complete().applicationDefaults,
        salary: { amount: 1, currency: "eur", period: "year" },
      },
    };
    const tooMany = {
      ...complete(),
      experience: Array.from({ length: 51 }, () => ({
        company: "A",
        title: "B",
        location: "",
        startDate: "",
        endDate: "",
        bullets: [],
      })),
    };
    expect(ProfileSchema.safeParse(blankSkill).success).toBe(false);
    expect(ProfileSchema.safeParse(lowerCurrency).success).toBe(false);
    expect(ProfileSchema.safeParse(tooMany).success).toBe(false);
  });
});

describe("scoring snapshot", () => {
  it("ignores contact details, links and application defaults", () => {
    const base = complete();
    const edited: Profile = {
      ...base,
      contact: { ...base.contact, phone: "+39 000" },
      links: [],
      standardAnswers: [],
      applicationDefaults: { ...base.applicationDefaults, noticePeriod: "2 months" },
    };
    expect(scoringSnapshot(edited)).toBe(scoringSnapshot(base));
  });

  it("changes when a skill or the headline changes", () => {
    const base = complete();
    const withSkill: Profile = {
      ...base,
      skills: [...base.skills, { name: "Go", level: "", aliases: [] }],
    };
    expect(scoringSnapshot(withSkill)).not.toBe(scoringSnapshot(base));
    expect(scoringSnapshot({ ...base, headline: "Staff Engineer" })).not.toBe(
      scoringSnapshot(base),
    );
  });
});

describe("CV extraction", () => {
  it("fills missing sections and keeps the rest of the profile on apply", () => {
    const extraction = CvExtractionSchema.parse({ headline: "Engineer" });
    expect(extraction.experience).toEqual([]);
    const merged = applyCvExtraction(complete(), extraction);
    expect(merged.headline).toBe("Engineer");
    expect(merged.applicationDefaults.noticePeriod).toBe("1 month");
  });
});

describe("education category", () => {
  it("tells a degree from a course by the title, for an entry saved without a category, and keeps a given one", () => {
    const parsed = ProfileSchema.parse({
      ...emptyProfile(),
      education: [
        {
          institution: "UniPa",
          degree: "BSc in Computer and Telecommunications Engineering",
          grade: "",
          startDate: "",
          endDate: "",
        },
        {
          institution: "Biogem",
          degree: "UIIP Program – IT Specialist Academy: Mobile Apps & Digital",
          grade: "",
          startDate: "",
          endDate: "",
        },
        {
          institution: "PoliTo",
          degree: "Laurea in Informatica",
          grade: "",
          startDate: "",
          endDate: "",
        },
        {
          institution: "Acme",
          degree: "Platform course",
          category: "degree",
          grade: "",
          startDate: "",
          endDate: "",
        },
      ],
    });

    expect(parsed.education.map((item) => item.category)).toEqual([
      "degree",
      "course",
      "degree",
      "degree",
    ]);
    expect(inferEducationCategory("MSc")).toBe("degree");
    expect(inferEducationCategory("")).toBe("course");
  });

  it("does not count the education category as a scoring change, so existing scores stay valid", () => {
    const withCourse = {
      ...complete(),
      education: [
        {
          institution: "A",
          degree: "BSc",
          category: "degree" as const,
          grade: "",
          startDate: "",
          endDate: "",
        },
      ],
    };
    const recategorised = {
      ...withCourse,
      education: [{ ...withCourse.education[0]!, category: "course" as const }],
    };
    expect(scoringSnapshot(recategorised)).toBe(scoringSnapshot(withCourse));
  });
});
