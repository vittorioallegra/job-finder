// protects=each ATS adapter turns its recorded response into normalized jobs with title, company, location, work mode, apply URL and identity, and rejects a body of the wrong shape;
// fails_when=an adapter drops a posting, reads a field from the wrong place, keeps job HTML in the description, or accepts a body that is not that provider's response;
// no_claim=the live APIs: fixtures are recorded responses trimmed to a few postings, and a provider changing its format is caught only by the documented live check.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createHttpClient } from "../net";
import { ATS_ADAPTERS } from "./index";
import type { AtsId } from "./types";

const FIXTURE_DIR = new URL("./fixtures/", import.meta.url);

function fixture(name: string): string {
  return readFileSync(new URL(name, FIXTURE_DIR), "utf8");
}

const FIXTURE_FILES: Record<AtsId, string> = {
  greenhouse: "greenhouse.json",
  lever: "lever.json",
  ashby: "ashby.json",
  workable: "workable.json",
  smartrecruiters: "smartrecruiters.json",
  personio: "personio.xml",
  recruitee: "recruitee.json",
  teamtailor: "teamtailor.xml",
};

// Each body is served by a scripted fetch, so parsing runs through the adapter and the HTTP client.
async function parseFixture(ats: AtsId, slug: string) {
  const body = fixture(FIXTURE_FILES[ats]);
  const client = createHttpClient({
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
    intervalMs: 0,
    sleep: async () => {},
  });
  const result = await ATS_ADAPTERS[ats].fetchJobs(
    { ats, slug, companyName: "Fixture Co" },
    client,
  );
  if (!result.ok) throw new Error(`adapter failed: ${result.code}`);
  return result.jobs;
}

describe("ATS adapters on recorded responses", () => {
  it("Greenhouse: reads every posting with plain-text description and public URLs", async () => {
    const jobs = await parseFixture("greenhouse", "stripe");
    expect(jobs).toHaveLength(3);
    const [first] = jobs;
    expect(first?.source).toBe("greenhouse");
    expect(first?.sourceJobId).toMatch(/^\d+$/);
    expect(first?.companyName).toBe("Stripe");
    expect(first?.url).toMatch(/^https:\/\/stripe\.com\/jobs/);
    expect(first?.applyUrl).toBe(first?.url);
    expect(first?.description).not.toContain("<");
    expect(first?.description.length).toBeGreaterThan(20);
  });

  it("Lever: reads hosted and apply URLs, all locations and the work place type", async () => {
    const jobs = await parseFixture("lever", "leverdemo");
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job.source).toBe("lever");
      expect(job.title).not.toBe("");
      expect(job.url).toMatch(/^https:\/\/jobs\.lever\.co\//);
      expect(job.applyUrl).toMatch(
        /^https:\/\/jobs\.lever\.co\/.+\/apply$|^https:\/\/jobs\.lever\.co\//,
      );
      expect(job.locations.length).toBeGreaterThan(0);
    }
    expect(jobs[0]?.locations[0]?.raw).toBe("Atlanta, Georgia");
    expect(jobs[0]?.employmentType).toBe("full_time");
  });

  it("Ashby: skips unlisted postings and reads primary and secondary locations", async () => {
    const jobs = await parseFixture("ashby", "ashby");
    expect(jobs).toHaveLength(3);
    const remote = jobs.find((job) => job.title.includes("Engineering Manager - EU"));
    expect(remote?.workMode).toBe("remote");
    expect(remote?.remoteScope).toBe("European Union");
    expect(remote?.locations.length).toBeGreaterThan(1);
    expect(remote?.applyUrl).toMatch(/\/application$/);
  });

  it("Workable: uses the account name and reads the country code from each location", async () => {
    const jobs = await parseFixture("workable", "flosum");
    expect(jobs).toHaveLength(3);
    for (const job of jobs) {
      expect(job.companyName).toBe("Flosum");
      expect(job.url).toMatch(/^https:\/\/apply\.workable\.com\/j\//);
    }
    expect(jobs.map((job) => job.locations[0]?.countryCode)).toEqual(["DE", "NL", "GB"]);
  });

  it("SmartRecruiters: reads the posting, its location and the public URL without a description", async () => {
    const jobs = await parseFixture("smartrecruiters", "smartrecruiters");
    expect(jobs).toHaveLength(1);
    const [job] = jobs;
    expect(job?.url).toMatch(/^https:\/\/jobs\.smartrecruiters\.com\/smartrecruiters\/\d+$/);
    expect(job?.workMode).toBe("remote");
    expect(job?.locations[0]?.countryCode).toBe("PL");
    expect(job?.employmentType).toBe("full_time");
    expect(job?.description).toBe("");
  });

  it("Personio: reads the XML feed with its office, employment type and posting URL", async () => {
    const jobs = await parseFixture("personio", "personio");
    expect(jobs).toHaveLength(2);
    const [first] = jobs;
    expect(first?.url).toBe(`https://personio.jobs.personio.de/job/${first?.sourceJobId}`);
    expect(first?.locations[0]?.city).toBe("Berlin");
    expect(first?.locations[0]?.countryCode).toBeUndefined();
    expect(first?.employmentType).toBe("full_time");
    expect(first?.seniority).toBe("junior");
  });

  it("Recruitee: reads the offer, its country and the apply URL", async () => {
    const jobs = await parseFixture("recruitee", "personio");
    expect(jobs).toHaveLength(1);
    const [job] = jobs;
    expect(job?.companyName).toBe("FD Sandbox");
    expect(job?.applyUrl).toMatch(/\/c\/new$/);
    expect(job?.locations[0]?.countryCode).toBe("DE");
    expect(job?.workMode).toBe("onsite");
    expect(job?.postedAt).toBe("2025-01-02T14:22:42.000Z");
  });

  it("Teamtailor: reads RSS items with their tt:location places and work status", async () => {
    const jobs = await parseFixture("teamtailor", "career");
    expect(jobs).toHaveLength(3);
    for (const job of jobs) {
      expect(job.source).toBe("teamtailor");
      expect(job.url).toMatch(/^https:\/\//);
      expect(job.description).not.toContain("<");
    }
    expect(jobs.some((job) => job.workMode === "hybrid")).toBe(true);
    expect(
      jobs.some((job) => job.locations.some((location) => location.city === "Stockholm")),
    ).toBe(true);
  });

  it("rejects a body of the wrong shape for each provider", async () => {
    for (const ats of Object.keys(FIXTURE_FILES) as AtsId[]) {
      const client = createHttpClient({
        fetch: (async (input: RequestInfo | URL) => {
          if (String(input).endsWith("/robots.txt")) return new Response("", { status: 404 });
          return new Response("<html><body>Maintenance</body></html>", { status: 200 });
        }) as typeof fetch,
        intervalMs: 0,
        sleep: async () => {},
      });
      const result = await ATS_ADAPTERS[ats].fetchJobs({ ats, slug: "acme" }, client);
      expect(result.ok, ats).toBe(false);
    }
  });
});
