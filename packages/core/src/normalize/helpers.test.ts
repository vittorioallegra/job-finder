// protects=normalized job field helpers map ATS and free-text values to the spec's enums, countries, locations and salaries without guessing;
// fails_when=a country region is read as a country, "remote" becomes a city, a bare number becomes a salary, a negative visa statement reads as yes, or a job description's stray "remote" sets the work mode;
// no_claim=coverage of every language and every label an ATS can send; these are stated examples, not a complete taxonomy.
import { describe, expect, it } from "vitest";
import { countryCodeFor } from "./countries";
import { employmentTypeFrom } from "./employment-type";
import { detectLanguage } from "./language";
import { normalizeLocation, locationFromParts } from "./location";
import { parseSalaryText } from "./salary";
import { seniorityFrom } from "./seniority";
import { htmlToText, escapedHtmlToText } from "./text";
import { visaSponsorshipFrom } from "./visa";
import { remoteScopeFrom, resolveWorkMode, workModeFrom } from "./work-mode";

describe("countryCodeFor", () => {
  it("maps English and Italian names, aliases and codes, and refuses regions", () => {
    expect(countryCodeFor("Germany")).toBe("DE");
    expect(countryCodeFor("Deutschland")).toBe("DE");
    expect(countryCodeFor("Italia")).toBe("IT");
    expect(countryCodeFor("UK")).toBe("GB");
    expect(countryCodeFor("U.S.A.")).toBe("US");
    expect(countryCodeFor("Georgia")).toBeUndefined();
    expect(countryCodeFor("France")).toBe("FR");
    expect(countryCodeFor("United Kingdom")).toBe("GB");
    expect(countryCodeFor("CA")).toBeUndefined();
    expect(countryCodeFor("European Union")).toBeUndefined();
    expect(countryCodeFor("EU")).toBeUndefined();
    expect(countryCodeFor("Atlantis")).toBeUndefined();
  });
});

describe("normalizeLocation", () => {
  it("does not read a US state or a state code as a country", () => {
    expect(normalizeLocation("Atlanta, Georgia")).toEqual({
      raw: "Atlanta, Georgia",
      city: "Atlanta",
      region: "Georgia",
    });
    expect(normalizeLocation("San Francisco, CA")).toEqual({
      raw: "San Francisco, CA",
      city: "San Francisco",
      region: "CA",
    });
  });

  it("reads city, region and country from comma-separated text", () => {
    expect(normalizeLocation("Berlin, Berlin, Deutschland")).toEqual({
      raw: "Berlin, Berlin, Deutschland",
      city: "Berlin",
      region: "Berlin",
      countryCode: "DE",
    });
    expect(normalizeLocation("Milan, Italy")).toEqual({
      raw: "Milan, Italy",
      city: "Milan",
      countryCode: "IT",
    });
  });

  it("never turns a remote label into a city", () => {
    expect(normalizeLocation("Remote - Italy")).toEqual({
      raw: "Remote - Italy",
      countryCode: "IT",
    });
    expect(normalizeLocation("Remote - European Union")).toEqual({
      raw: "Remote - European Union",
    });
  });
});

describe("locationFromParts", () => {
  it("uses a country code when given and drops empty parts", () => {
    expect(locationFromParts({ city: "Stockholm", country: "Sweden", countryCode: null })).toEqual({
      raw: "Stockholm, Sweden",
      city: "Stockholm",
      countryCode: "SE",
    });
    expect(locationFromParts({ city: " ", country: "", region: null })).toBeUndefined();
  });
});

describe("work mode", () => {
  it("reads hybrid, on-site and remote labels in English and Italian", () => {
    expect(workModeFrom("Hybrid - Milan")).toBe("hybrid");
    expect(workModeFrom("On-site, Berlin")).toBe("onsite");
    expect(workModeFrom("Remoto dall'Italia")).toBe("remote");
    expect(workModeFrom("Berlin")).toBe("unknown");
  });

  it("prefers a structured value over text", () => {
    expect(resolveWorkMode("on-site", "Remote - Italy")).toBe("onsite");
    expect(resolveWorkMode(undefined, "", "Remote")).toBe("remote");
  });

  it("reads remote scope after the word remote", () => {
    expect(remoteScopeFrom("Remote - European Union")).toBe("European Union");
    expect(remoteScopeFrom("Remote (EU)")).toBe("EU");
    expect(remoteScopeFrom("Remote")).toBeUndefined();
  });
});

describe("employment type", () => {
  it("maps ATS labels, with part time before full time", () => {
    expect(employmentTypeFrom("Regular Full Time (Salary)")).toBe("full_time");
    expect(employmentTypeFrom("PartTime")).toBe("part_time");
    expect(employmentTypeFrom("fulltime_permanent")).toBe("full_time");
    expect(employmentTypeFrom("Intern")).toBe("internship");
    expect(employmentTypeFrom("tempo determinato")).toBe("temporary");
    expect(employmentTypeFrom(undefined)).toBe("unknown");
  });
});

describe("seniority", () => {
  it("reads seniority from titles and levels", () => {
    expect(seniorityFrom("Senior Backend Engineer (m/w/d)")).toBe("senior");
    expect(seniorityFrom("Senior / Lead Engineering Operations Manager")).toBe("lead");
    expect(seniorityFrom("Mid-Senior Level")).toBe("senior");
    expect(seniorityFrom("Junior Data Analyst")).toBe("junior");
    expect(seniorityFrom("Werkstudent Intern")).toBe("intern");
    expect(seniorityFrom("Backend Engineer")).toBe("unknown");
  });
});

describe("salary", () => {
  it("parses ranges with currency and period, in both separator styles", () => {
    expect(parseSalaryText("€50,000 - €60,000 per year")).toEqual({
      min: 50000,
      max: 60000,
      currency: "EUR",
      period: "year",
    });
    expect(parseSalaryText("50.000 - 60.000 € all'anno")).toEqual({
      min: 50000,
      max: 60000,
      currency: "EUR",
      period: "year",
    });
    expect(parseSalaryText("$120k–$140k a year")).toEqual({
      min: 120000,
      max: 140000,
      currency: "USD",
      period: "year",
    });
    expect(parseSalaryText("CHF 9'000 per month")).toEqual({
      min: 9000,
      currency: "CHF",
      period: "month",
    });
  });

  it("refuses text without a currency", () => {
    expect(parseSalaryText("Compensation 50000 - 60000 per year")).toBeUndefined();
    expect(parseSalaryText("We are hiring in 2026")).toBeUndefined();
  });
});

describe("visa sponsorship", () => {
  it("reads negative statements before positive ones", () => {
    expect(visaSponsorshipFrom("We do not sponsor visas for this role.")).toBe("no");
    expect(visaSponsorshipFrom("Senza sponsorizzazione del visto")).toBe("no");
    expect(visaSponsorshipFrom("Visa sponsorship is available for this role.")).toBe("yes");
    expect(visaSponsorshipFrom("Visa sponsorship is not available.")).toBe("no");
    expect(visaSponsorshipFrom("Remote team, Berlin office.")).toBe("unknown");
  });
});

describe("detectLanguage", () => {
  it("names the language of a long enough text and stays silent otherwise", () => {
    const english =
      "We are looking for an engineer who will help the team build the product and you will work with our users for the whole year.";
    const german =
      "Wir suchen eine Entwicklerin, die mit uns im Team arbeitet und die Produkte für die Kunden weiterentwickelt, und das ist nicht nur ein Job.";
    expect(detectLanguage(english)).toBe("en");
    expect(detectLanguage(german)).toBe("de");
    expect(detectLanguage("Hello world")).toBeUndefined();
  });
});

describe("text", () => {
  it("turns HTML into plain text with line breaks and no scripts", () => {
    expect(
      htmlToText("<h2>About</h2><p>Hello <b>team</b></p><script>x()</script><ul><li>One</li></ul>"),
    ).toBe("About\nHello team\nOne");
  });

  it("decodes escaped HTML before stripping it", () => {
    expect(escapedHtmlToText("&lt;p&gt;Build &amp;amp; ship&lt;/p&gt;")).toBe("Build & ship");
  });
});
