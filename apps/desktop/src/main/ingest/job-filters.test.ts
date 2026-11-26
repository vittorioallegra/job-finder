// protects=a job posted before the age limit is hidden, roles match the title without level words or hyphens and with engineer, developer and sviluppatore taken as one, each job filter includes and excludes the expected jobs over a fixed fixture set in SQLite, the combinations narrow the results, the affinity order puts unscored jobs last and the newest order uses the posting date when there is one, and dismissed, closed and unknown jobs stay out;
// fails_when=a filter includes a job it should exclude or drops one it should keep, a LIKE wildcard in a place matches everything, a dismissed or closed job is listed, or the score order is wrong;
// no_claim=the scoring run is not covered here; the core filter schema tests and the scoring service tests cover them, and the fixture set is small, not a sample of real postings;
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { companies, jobFlags, jobScores, jobSources, jobs, profile } from "@job-finder/core";
import { JobFilterSchema, type JobFilterInput } from "@job-finder/core/filters";
import { openAppDatabase, type AppDatabase } from "../db/database";
import { refreshCompanyCountries } from "../db/company-country";
import { createIngestRepository, type IngestRepository } from "./repository";

const repoMigrations = resolve(__dirname, "../../../drizzle");
const NOW = Date.UTC(2026, 10, 23);
const DAY = 24 * 60 * 60 * 1000;

interface Fixture {
  id: string;
  company: "c1" | "c2";
  title: string;
  description: string;
  locations: Array<{ raw: string; city?: string; region?: string; countryCode?: string }>;
  workMode: string;
  remoteScope?: string;
  employmentType: string;
  seniority: string;
  salary?: { min?: number; max?: number; currency?: string; period?: string };
  visa: string;
  language: string;
  postedAt?: number;
  firstSeenAt: number;
  closedAt?: number;
  source: string;
  score?: number;
  dismissed?: boolean;
}

const FIXTURES: Fixture[] = [
  {
    id: "j1",
    company: "c1",
    title: "Backend Engineer",
    description: "Build APIs in TypeScript and Go.",
    locations: [{ raw: "Milan, Italy", city: "Milan", region: "Lombardy", countryCode: "IT" }],
    workMode: "hybrid",
    employmentType: "full_time",
    seniority: "senior",
    salary: { min: 60000, max: 70000, currency: "EUR", period: "year" },
    visa: "yes",
    language: "en",
    postedAt: NOW - DAY,
    firstSeenAt: NOW - DAY,
    source: "greenhouse",
    score: 90,
  },
  {
    id: "j2",
    company: "c1",
    title: "Frontend Developer",
    description: "React work. Remote in the EU.",
    locations: [{ raw: "Remote - EU" }],
    workMode: "remote",
    remoteScope: "EU",
    employmentType: "contract",
    seniority: "mid",
    visa: "unknown",
    language: "en",
    firstSeenAt: NOW - 10 * DAY,
    source: "lever",
    score: 40,
  },
  {
    id: "j3",
    company: "c2",
    title: "Sviluppatore Backend",
    description: "Node.js e PostgreSQL",
    locations: [{ raw: "Berlin, Germany", city: "Berlin", countryCode: "DE" }],
    workMode: "onsite",
    employmentType: "full_time",
    seniority: "junior",
    salary: { min: 45000, currency: "EUR", period: "year" },
    visa: "no",
    language: "it",
    firstSeenAt: NOW - 2 * DAY,
    source: "ashby",
  },
  {
    id: "j4",
    company: "c2",
    title: "Data Engineer",
    description: "Pipelines on Kubernetes.",
    locations: [{ raw: "New York, USA", city: "New York", countryCode: "US" }],
    workMode: "hybrid",
    employmentType: "full_time",
    seniority: "senior",
    salary: { min: 90000, currency: "USD", period: "year" },
    visa: "unknown",
    language: "en",
    postedAt: NOW - 40 * DAY,
    firstSeenAt: NOW - 40 * DAY,
    source: "ashby",
    score: 70,
  },
  {
    id: "j5",
    company: "c1",
    title: "Backend Intern",
    description: "Go backend internship.",
    locations: [{ raw: "Milan, Italy", city: "Milan", countryCode: "IT" }],
    workMode: "onsite",
    employmentType: "internship",
    seniority: "intern",
    visa: "unknown",
    language: "en",
    firstSeenAt: NOW - DAY,
    source: "greenhouse",
    score: 85,
    dismissed: true,
  },
  {
    id: "j6",
    company: "c1",
    title: "Old Backend Role",
    description: "Closed posting.",
    locations: [{ raw: "Milan, Italy", city: "Milan", countryCode: "IT" }],
    workMode: "onsite",
    employmentType: "full_time",
    seniority: "senior",
    visa: "unknown",
    language: "en",
    firstSeenAt: NOW - 3 * DAY,
    closedAt: NOW - DAY,
    source: "greenhouse",
  },
  {
    id: "j7",
    company: "c1",
    title: "Platform Engineer",
    description: "Terraform and Kubernetes.",
    locations: [{ raw: "Paris, France", city: "Paris", countryCode: "FR" }],
    workMode: "hybrid",
    employmentType: "full_time",
    seniority: "senior",
    salary: { min: 50000, max: 52000, currency: "EUR", period: "month" },
    visa: "yes",
    language: "en",
    firstSeenAt: NOW - 5 * DAY,
    source: "ashby",
  },
];

async function openDatabase(): Promise<AppDatabase> {
  const dir = mkdtempSync(join(tmpdir(), "job-finder-filters-"));
  return openAppDatabase({
    file: join(dir, "job-finder.sqlite"),
    migrationsFolder: repoMigrations,
    backupDirectory: join(dir, "backups"),
  });
}

describe("job filters over the fixture set", () => {
  let database: AppDatabase;
  let repository: IngestRepository;

  beforeEach(async () => {
    database = await openDatabase();
    await database.db.insert(companies).values([
      {
        id: "c1",
        name: "Acme",
        careersUrl: "https://boards.greenhouse.io/acme",
        ats: "greenhouse",
        slug: "acme",
        createdAt: 1,
      },
      {
        id: "c2",
        name: "Beta",
        careersUrl: "https://jobs.ashbyhq.com/beta",
        ats: "ashby",
        slug: "beta",
        createdAt: 2,
      },
    ]);
    await database.db.insert(profile).values({ id: 1, data: "{}", version: 1, updatedAt: 1 });
    for (const fixture of FIXTURES) {
      await database.db.insert(jobs).values({
        id: fixture.id,
        companyId: fixture.company,
        fingerprint: `fp-${fixture.id}`,
        title: fixture.title,
        description: fixture.description,
        url: `https://x.test/${fixture.id}`,
        applyUrl: `https://x.test/${fixture.id}/apply`,
        language: fixture.language,
        locations: JSON.stringify(fixture.locations),
        workMode: fixture.workMode,
        remoteScope: fixture.remoteScope ?? null,
        employmentType: fixture.employmentType,
        seniority: fixture.seniority,
        salary: fixture.salary ? JSON.stringify(fixture.salary) : null,
        visaSponsorship: fixture.visa,
        postedAt: fixture.postedAt ?? null,
        firstSeenAt: fixture.firstSeenAt,
        lastSeenAt: fixture.firstSeenAt,
        closedAt: fixture.closedAt ?? null,
      });
      await database.db.insert(jobSources).values({
        source: fixture.source,
        sourceJobId: `${fixture.id}-src`,
        jobId: fixture.id,
        companyId: fixture.company,
        url: `https://x.test/${fixture.id}`,
        applyUrl: `https://x.test/${fixture.id}/apply`,
        lastRunId: "run-1",
        firstSeenAt: fixture.firstSeenAt,
        lastSeenAt: fixture.firstSeenAt,
        closedAt: fixture.closedAt ?? null,
      });
      if (fixture.score !== undefined) {
        await database.db.insert(jobScores).values({
          jobId: fixture.id,
          profileVersion: 1,
          jobHash: "jh",
          profileHash: "ph",
          model: "local-test",
          promptVersion: 2,
          explanationLanguage: "en",
          score: fixture.score,
          explanation: "Fit.",
          createdAt: 1,
        });
      }
      if (fixture.dismissed) {
        await database.db
          .insert(jobFlags)
          .values({ jobId: fixture.id, dismissedAt: NOW, viewedAt: null, updatedAt: NOW });
      }
    }
    // Where the companies are based: Acme in Italy, Beta in Germany.
    await database.db.update(companies).set({ country: "IT" }).where(eq(companies.id, "c1"));
    await database.db.update(companies).set({ country: "DE" }).where(eq(companies.id, "c2"));
    repository = createIngestRepository(database.db);
  });

  afterEach(() => {
    database.close();
  });

  /** The titles listed for a filter, sorted, so the expectation does not depend on the order. */
  async function titles(filter: JobFilterInput = {}, sort: "affinity" | "newest" = "affinity") {
    const listed = await repository.listJobs({ filter: JobFilterSchema.parse(filter), sort });
    return listed.map((job) => job.title).sort();
  }

  it("lists every open job that is not dismissed, leaving out the closed and the dismissed ones", async () => {
    expect(await titles()).toEqual(
      [
        "Backend Engineer",
        "Data Engineer",
        "Frontend Developer",
        "Platform Engineer",
        "Sviluppatore Backend",
      ].sort(),
    );
    expect(await titles({ hideDismissed: false })).toContain("Backend Intern");
    expect(await titles({ hideDismissed: false })).not.toContain("Old Backend Role");
  });

  it("matches roles against the title, without level words and whatever the hyphens or spaces", async () => {
    expect(await titles({ roles: ["Senior Front-end Developer"] })).toEqual(["Frontend Developer"]);
    // Engineer, developer and the Italian "sviluppatore" name the same work.
    expect(await titles({ roles: ["Backend Engineer", "Data Engineer"] })).toEqual(
      ["Backend Engineer", "Data Engineer", "Sviluppatore Backend"].sort(),
    );
    expect(await titles({ roles: ["Backend Developer"] })).toEqual(
      ["Backend Engineer", "Sviluppatore Backend"].sort(),
    );
    // The description does not count: a role is what the job is called.
    expect(await titles({ roles: ["Kubernetes"] })).toEqual([]);
  });

  it("hides jobs posted before the age limit, counting an undated job from when it was first seen", async () => {
    const { jobFilterCondition } = await import("@job-finder/core/filters/sql");
    const open = async (maxAgeDays: number) =>
      (
        await database.db
          .select({ title: jobs.title })
          .from(jobs)
          .where(
            jobFilterCondition(JobFilterSchema.parse({ maxAgeDays, hideDismissed: false }), NOW),
          )
      )
        .map((row) => row.title)
        .sort();
    const all = await open(0);
    const recent = await open(30);
    // "Data Engineer" was posted 40 days before, "Frontend Developer" 1 day before.
    expect(all).toContain("Data Engineer");
    expect(recent).not.toContain("Data Engineer");
    expect(recent).toContain("Frontend Developer");
    expect(recent.length).toBeLessThan(all.length);
  });

  it("treats LIKE wildcards in a place as plain characters", async () => {
    // Only the remote job stays: it has no city to compare.
    expect(await titles({ places: ["%"] })).toEqual(["Frontend Developer"]);
    expect(await titles({ places: ["_"] })).toEqual(["Frontend Developer"]);
  });

  it("filters by work mode and employment type", async () => {
    expect(await titles({ workModes: ["remote"] })).toEqual(["Frontend Developer"]);
    expect(await titles({ workModes: ["onsite", "hybrid"] })).toEqual(
      ["Backend Engineer", "Data Engineer", "Platform Engineer", "Sviluppatore Backend"].sort(),
    );
    expect(await titles({ employmentTypes: ["contract"] })).toEqual(["Frontend Developer"]);
    expect(await titles({ employmentTypes: ["internship"], hideDismissed: false })).toEqual([
      "Backend Intern",
    ]);
  });

  it("filters by places: a country or an area keeps local jobs and remote jobs open to it", async () => {
    // Italy: the two Milan jobs, and the remote job whose scope is the EU (which includes Italy).
    expect(await titles({ places: ["Italia"], hideDismissed: false })).toEqual(
      ["Backend Engineer", "Backend Intern", "Frontend Developer"].sort(),
    );
    // The EU as a whole: every EU office plus the EU-wide remote job, not New York.
    expect(await titles({ places: ["UE"] })).toEqual(
      [
        "Backend Engineer",
        "Frontend Developer",
        "Platform Engineer",
        "Sviluppatore Backend",
      ].sort(),
    );
    // A city matches its own jobs; the remote job stays since it has no city to compare.
    expect(await titles({ places: ["Berlin"] })).toEqual(
      ["Frontend Developer", "Sviluppatore Backend"].sort(),
    );
    // The New York job belongs to a German company, so it is not listed for the United States.
    expect(await titles({ places: ["Stati Uniti"] })).toEqual([]);
  });

  it("keeps to companies based in the chosen country: Italy means Italian companies, also for remote jobs", async () => {
    // protects=a country or an area in the places keeps jobs of companies based there (the country where most of their open jobs are) but not of companies whose country is not known, even for remote jobs open to the country; fails_when=a remote job of a German company is listed for Italy, an Italian company is dropped, or a company with no known country is listed for a country; no_claim=how the company country is first computed from real scans;
    await database.db.insert(jobs).values({
      id: "j9",
      companyId: "c2",
      fingerprint: "fp-j9",
      title: "Remote Support Engineer",
      description: "Support work, remote in the EU.",
      url: "https://x.test/j9",
      applyUrl: "https://x.test/j9/apply",
      language: "en",
      locations: JSON.stringify([{ raw: "Remote - EU" }]),
      workMode: "remote",
      remoteScope: "EU",
      employmentType: "full_time",
      seniority: "mid",
      visaSponsorship: "unknown",
      firstSeenAt: NOW - DAY,
      lastSeenAt: NOW,
    });
    // A company whose country is not known is not listed for a country: nothing says it is there.
    await database.db.update(companies).set({ country: null });
    expect(await titles({ places: ["Italia"] })).toEqual([]);
    // A city does not look at the company.
    expect(await titles({ places: ["Milan"] })).toContain("Backend Engineer");

    await refreshCompanyCountries(database.db);

    // c1 is Italian (two open jobs in Milan), c2 German (Berlin and New York tie, DE comes first).
    const italy = await titles({ places: ["Italia"], hideDismissed: false });
    expect(italy).toEqual(["Backend Engineer", "Backend Intern", "Frontend Developer"].sort());
    expect(italy).not.toContain("Remote Support Engineer");
    expect(await titles({ places: ["Germania"] })).toContain("Remote Support Engineer");
    // The EU reaches both companies' countries.
    expect(await titles({ places: ["UE"] })).toContain("Remote Support Engineer");
    // A city is not a country: Milan keeps its jobs whoever the company is.
    expect(await titles({ places: ["Milan"] })).toContain("Backend Engineer");
  });

  it("shows only jobs the user has not viewed when new-only is set, and the viewed ones again after a flag change", async () => {
    expect(await titles({ newOnly: true })).toHaveLength(5);

    await repository.setJobFlag({ jobId: "j1", viewed: true });

    const after = await titles({ newOnly: true });
    expect(after).not.toContain("Backend Engineer");
    expect(after).toHaveLength(4);
  });

  it("combines filters: every condition must hold", async () => {
    expect(await titles({ roles: ["backend"], workModes: ["hybrid"] })).toEqual([
      "Backend Engineer",
    ]);
    expect(
      await titles({ roles: ["backend"], places: ["Germania"], workModes: ["hybrid"] }),
    ).toEqual([]);
  });

  it("orders by affinity with unscored jobs last, and by newest posting date when asked", async () => {
    const byAffinity = await repository.listJobs(
      {
        filter: JobFilterSchema.parse({}),
        sort: "affinity",
      },
      NOW,
    );
    expect(byAffinity.map((job) => job.title)).toEqual([
      "Backend Engineer",
      "Data Engineer",
      "Frontend Developer",
      "Sviluppatore Backend",
      "Platform Engineer",
    ]);
    expect(byAffinity.map((job) => job.isNew)).toEqual([true, true, true, true, true]);

    const newest = await repository.listJobs(
      { filter: JobFilterSchema.parse({}), sort: "newest" },
      NOW,
    );
    expect(newest.map((job) => job.title)).toEqual([
      "Backend Engineer",
      "Sviluppatore Backend",
      "Platform Engineer",
      "Frontend Developer",
      "Data Engineer",
    ]);
  });
});
