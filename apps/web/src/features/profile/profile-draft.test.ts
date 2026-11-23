// protects=the profile form converts to a valid profile and back without losing entries, drops blank rows, splits bullets and aliases, and refuses values the schema rejects;
// fails_when=a filled entry is lost or changed by a round trip, a blank row is saved, a bullet or alias is kept joined, a non-numeric salary or malformed email is accepted, or a CV extraction overwrites application defaults;
// no_claim=whether the typed values are sensible for a real career is not judged; only the shape and bounds are.
import { describe, expect, it } from "vitest";
import { emptyProfile, type Profile } from "@job-finder/bridge";
import { draftFromExtraction, draftFromProfile, profileFromDraft } from "./profile-draft";

function sample(): Profile {
  return {
    ...emptyProfile(),
    contact: { fullName: "Maria Rossi", email: "maria@example.com", phone: "", location: "Milano" },
    headline: "Backend Engineer",
    experience: [
      {
        company: "Acme",
        title: "Engineer",
        location: "",
        startDate: "2021",
        endDate: "present",
        bullets: ["Led a migration", "Mentored two engineers"],
      },
    ],
    skills: [{ name: "TypeScript", level: "expert", aliases: ["TS", "ts"] }],
    applicationDefaults: {
      workAuthorization: [{ country: "IT", status: "citizen" }],
      noticePeriod: "1 month",
      salary: { amount: 60000, currency: "EUR", period: "year" },
      willingToRelocate: false,
      pronouns: "",
    },
  };
}

describe("profile draft", () => {
  it("round-trips a filled profile without changing it", () => {
    const profile = sample();
    expect(profileFromDraft(draftFromProfile(profile))).toEqual(profile);
  });

  it("drops rows that are completely blank", () => {
    const draft = draftFromProfile(sample());
    draft.experience.push({
      company: "",
      title: "",
      location: "",
      startDate: "",
      endDate: "",
      bullets: "  ",
    });
    draft.skills.push({ name: "", level: "", aliases: "" });

    const profile = profileFromDraft(draft);

    expect(profile?.experience).toHaveLength(1);
    expect(profile?.skills).toHaveLength(1);
  });

  it("refuses a partly filled link row, since a link needs its URL", () => {
    const draft = draftFromProfile(sample());
    draft.links.push({ label: "Portfolio", url: "" });

    expect(profileFromDraft(draft)).toBeNull();
  });

  it("splits bullets by line and aliases by comma, and trims them", () => {
    const draft = draftFromProfile(sample());
    draft.experience[0] = { ...draft.experience[0]!, bullets: " one \n\n two " };
    draft.skills[0] = { ...draft.skills[0]!, aliases: " TS , ,typescript " };

    const profile = profileFromDraft(draft);

    expect(profile?.experience[0]?.bullets).toEqual(["one", "two"]);
    expect(profile?.skills[0]?.aliases).toEqual(["TS", "typescript"]);
  });

  it("refuses a malformed email, a non-numeric salary and a non-HTTP link", () => {
    const badEmail = draftFromProfile(sample());
    badEmail.contact.email = "maria at example";
    const badSalary = draftFromProfile(sample());
    badSalary.applicationDefaults.salaryAmount = "sixty";
    const badLink = draftFromProfile(sample());
    badLink.links = [{ label: "x", url: "ftp://example.com" }];

    expect(profileFromDraft(badEmail)).toBeNull();
    expect(profileFromDraft(badSalary)).toBeNull();
    expect(profileFromDraft(badLink)).toBeNull();
  });

  it("seeds a draft from a CV extraction and keeps the empty application defaults", () => {
    const draft = draftFromExtraction(
      {
        contact: { fullName: "Luca Bianchi", email: "", phone: "", location: "" },
        headline: "Frontend Developer",
        summary: "",
        experience: [],
        education: [],
        skills: [{ name: "React", level: "", aliases: [] }],
        languages: [],
        certifications: [],
        links: [],
      },
      emptyProfile(),
    );

    expect(draft.headline).toBe("Frontend Developer");
    expect(draft.applicationDefaults.salaryAmount).toBe("");
    expect(profileFromDraft(draft)?.applicationDefaults.salary.amount).toBeNull();
  });
});
