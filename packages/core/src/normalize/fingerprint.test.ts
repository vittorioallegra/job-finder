// protects=cross-source dedupe groups the same opening from different sources, and only that: company legal suffixes, gender markers and location order do not matter, but a different location or title keeps jobs apart;
// fails_when=the same role on two sources gets two fingerprints, two different roles share one, or the location order changes the fingerprint;
// no_claim=matching of differently worded titles or of companies that were renamed; the plan keeps those apart on purpose.
import { describe, expect, it } from "vitest";
import type { NormalizedJob } from "./job";
import { fingerprint, groupByFingerprint, normalizeCompany, normalizeTitle } from "./fingerprint";

function job(overrides: Partial<NormalizedJob>): NormalizedJob {
  return {
    source: "greenhouse",
    sourceJobId: "1",
    url: "https://example.test/1",
    applyUrl: "https://example.test/1",
    companyName: "Acme",
    title: "Backend Engineer",
    description: "",
    locations: [{ raw: "Milan, Italy", city: "Milan", countryCode: "IT" }],
    workMode: "unknown",
    employmentType: "unknown",
    seniority: "unknown",
    visaSponsorship: "unknown",
    ...overrides,
  };
}

describe("fingerprint", () => {
  it("is the same for one opening seen on two sources", () => {
    const fromBoard = job({
      source: "linkedin-like-board",
      sourceJobId: "x9",
      companyName: "Acme S.r.l.",
    });
    const fromAts = job({
      source: "lever",
      sourceJobId: "abc",
      companyName: "ACME",
      title: "Backend Engineer (m/w/d)",
      locations: [{ raw: "Milan, Italy", city: "Milan", countryCode: "IT" }],
    });
    expect(fingerprint(fromBoard)).toBe(fingerprint(fromAts));
  });

  it("ignores the order of locations", () => {
    const a = job({
      locations: [
        { raw: "Milan", city: "Milan", countryCode: "IT" },
        { raw: "Rome", city: "Rome", countryCode: "IT" },
      ],
    });
    const b = job({
      locations: [
        { raw: "Rome", city: "Rome", countryCode: "IT" },
        { raw: "Milan", city: "Milan", countryCode: "IT" },
      ],
    });
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it("separates different titles and different locations", () => {
    expect(fingerprint(job({ title: "Frontend Engineer" }))).not.toBe(fingerprint(job({})));
    expect(
      fingerprint(job({ locations: [{ raw: "Berlin", city: "Berlin", countryCode: "DE" }] })),
    ).not.toBe(fingerprint(job({})));
  });

  it("groups jobs by fingerprint and keeps the input order", () => {
    const first = job({ sourceJobId: "1" });
    const duplicate = job({ source: "lever", sourceJobId: "2", companyName: "Acme GmbH" });
    const other = job({ sourceJobId: "3", title: "Designer" });
    const groups = [...groupByFingerprint([first, other, duplicate]).values()];
    expect(groups.map((group) => group.map((item) => item.sourceJobId))).toEqual([
      ["1", "2"],
      ["3"],
    ]);
  });
});

describe("normalizeCompany and normalizeTitle", () => {
  it("drop legal suffixes and gender markers", () => {
    expect(normalizeCompany("Acme Holding GmbH")).toBe("acme holding");
    expect(normalizeCompany("Ltd")).toBe("ltd");
    expect(normalizeTitle("Data Engineer (m/f/d) - Remote")).toBe("data engineer remote");
  });
});
