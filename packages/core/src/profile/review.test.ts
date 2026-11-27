// protects=the checks that need no AI: an empty or thin profile is told what is missing in order of importance, skills are checked against both the skill list and the work text, and the postings for the roles show which asked-for skills the profile never names, only from enough postings and with plain words such as "rest" ignored;
// fails_when=a complete profile gets findings, a skill the profile names (as skill, alias or in a bullet) is reported missing, a share is computed from too few postings, "the rest of the team" counts as REST, or the findings are not most-serious-first;
// no_claim=which skills real postings ask for, which only the live postings show;
import { describe, expect, it } from "vitest";
import {
  marketSkillGaps,
  MIN_MARKET_JOBS,
  mentions,
  profileHasSkill,
  reviewProfileRules,
} from "./review";
import { emptyProfile, type Profile } from "./schema";

function complete(): Profile {
  return {
    ...emptyProfile(),
    headline: "Backend engineer",
    summary:
      "Backend engineer who builds payment services in TypeScript and PostgreSQL, with six years of experience in small product teams.",
    experience: [
      {
        company: "Northwind",
        title: "Backend Engineer",
        location: "Milano",
        startDate: "2021",
        endDate: "",
        bullets: [
          "Reduced checkout latency by 35 percent with TypeScript services",
          "Moved PostgreSQL reads to replicas",
          "Led a team of 4 engineers",
        ],
      },
    ],
    education: [
      {
        institution: "Politecnico",
        degree: "BSc",
        grade: "",
        startDate: "2014",
        endDate: "2017",
        category: "degree",
      },
    ],
    skills: ["TypeScript", "PostgreSQL", "Docker", "Node.js", "Git"].map((name) => ({
      name,
      level: "",
      aliases: [],
    })),
    languages: [{ name: "Italian", level: "native" }],
    links: [{ label: "GitHub", url: "https://github.com/example" }],
    preferences: {
      ...emptyProfile().preferences,
      roles: ["Backend Engineer"],
      locations: ["Italia"],
    },
  } as Profile;
}

describe("profile rules", () => {
  it("finds nothing in a complete profile (skills named only in the work text do not count as unbacked)", () => {
    const profile = complete();
    profile.skills = [...profile.skills];
    // Docker, Node.js and Git are listed but never named in the work text: three unbacked skills.
    const found = reviewProfileRules(profile, null).map((item) => item.code);
    expect(found).toEqual(["unbacked-skills"]);
    profile.experience[0]!.bullets.push("Ran Docker and Git workflows on Node.js services");
    expect(reviewProfileRules(profile, null)).toEqual([]);
  });

  it("tells an empty profile what is missing, most serious first", () => {
    const found = reviewProfileRules(emptyProfile(), null);
    const codes = found.map((item) => item.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "no-headline",
        "no-summary",
        "no-experience",
        "no-skills",
        "no-roles",
        "no-places",
        "no-languages",
        "no-education",
        "no-links",
      ]),
    );
    const order = { high: 0, medium: 1, low: 2 } as const;
    const severities = found.map((item) => order[item.severity]);
    expect(severities).toEqual([...severities].sort((a, b) => a - b));
  });

  it("flags thin parts with their numbers: a short summary, roles without bullets or dates, no figures, few skills", () => {
    const profile = complete();
    profile.summary = "Backend engineer.";
    profile.experience = [
      { company: "A", title: "Dev", location: "", startDate: "", endDate: "", bullets: [] },
      {
        company: "B",
        title: "Dev",
        location: "",
        startDate: "2020",
        endDate: "",
        bullets: ["Built APIs", "Wrote tests", "Improved speed"],
      },
    ];
    profile.skills = profile.skills.slice(0, 2);

    const byCode = Object.fromEntries(
      reviewProfileRules(profile, null).map((item) => [item.code, item]),
    );
    expect(byCode["short-summary"]?.params).toEqual({ length: 17 });
    expect(byCode["experience-no-bullets"]?.params).toEqual({ count: 1 });
    expect(byCode["experience-no-dates"]?.params).toEqual({ count: 1 });
    expect(byCode["no-numbers"]?.params).toEqual({ count: 3 });
    expect(byCode["few-skills"]?.params).toEqual({ count: 2 });
  });
});

describe("skills against the postings", () => {
  it("knows a skill by name, alias or a mention in the work text", () => {
    const profile = complete();
    expect(profileHasSkill(profile, "typescript")).toBe(true);
    expect(profileHasSkill(profile, "NodeJS")).toBe(true);
    expect(profileHasSkill(profile, "Kubernetes")).toBe(false);
    profile.experience[0]!.bullets.push("Deployed on Kubernetes");
    expect(profileHasSkill(profile, "Kubernetes")).toBe(true);
  });

  it("matches whole words, and only the exact spelling of words that are also plain English", () => {
    expect(mentions("We use C++ and .NET daily", "C++")).toBe(true);
    expect(mentions("We use C++ and .NET daily", ".NET")).toBe(true);
    expect(mentions("Experience with Studios and iOSX", "iOS")).toBe(false);
    expect(mentions("the rest of the team", "REST")).toBe(false);
    expect(mentions("Design REST APIs", "REST")).toBe(true);
    expect(mentions("to excel in the role", "Excel")).toBe(false);
  });

  it("reports the skills most postings ask for that the profile lacks, most asked first, from enough postings only", () => {
    const profile = complete();
    const texts = Array.from({ length: 30 }, (_, index) =>
      [
        "TypeScript services",
        index < 21 ? "Kubernetes" : "",
        index < 12 ? "Terraform" : "",
        index < 5 ? "Kafka" : "",
      ].join(" "),
    );

    const gaps = marketSkillGaps(profile, texts);
    expect(gaps).toEqual([
      { skill: "Kubernetes", jobs: 21, percent: 70 },
      { skill: "Terraform", jobs: 12, percent: 40 },
    ]);
    expect(marketSkillGaps(profile, texts.slice(0, MIN_MARKET_JOBS - 1))).toEqual([]);

    const found = reviewProfileRules(profile, gaps).filter(
      (item) => item.code === "market-skill-missing",
    );
    expect(found.map((item) => [item.params["skill"], item.severity])).toEqual([
      ["Kubernetes", "high"],
      ["Terraform", "high"],
    ]);
  });
});
