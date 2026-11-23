// protects=each job filter includes and excludes the expected jobs over a fixed fixture set in SQLite, the combinations narrow the results, the affinity order puts unscored jobs last and the newest order uses the posting date when there is one, and dismissed, closed and unknown jobs stay out;
// fails_when=a filter includes a job it should exclude or drops one it should keep, a LIKE wildcard in a keyword matches everything, a salary is compared across currencies or periods, a job without a posting date is dated wrongly, a dismissed or closed job is listed, or the score order is wrong;
// no_claim=the screen's filter form and the scoring run are not covered here; the core filter schema tests and the scoring service tests cover them, and the fixture set is small, not a sample of real postings;
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { companies, jobFlags, jobScores, jobSources, jobs, profile } from "@job-finder/core";
import { JobFilterSchema, type JobFilterInput } from "@job-finder/core/filters";
import { openAppDatabase, type AppDatabase } from "../db/database";
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
    repository = createIngestRepository(database.db);
  });

  afterEach(() => {
    database.close();
  });

  /** The titles listed for a filter, sorted, so the expectation does not depend on the order. */
  async function titles(filter: JobFilterInput = {}, sort: "affinity" | "newest" = "affinity") {
    const listed = await repository.listJobs({ filter: JobFilterSchema.parse(filter), sort }, NOW);
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

  it("matches keywords in the title or the description, and leaves out jobs with an excluded keyword", async () => {
    expect(await titles({ keywords: ["backend"] })).toEqual(
      ["Backend Engineer", "Sviluppatore Backend"].sort(),
    );
    expect(await titles({ keywords: ["kubernetes"] })).toEqual(
      ["Data Engineer", "Platform Engineer"].sort(),
    );
    expect(await titles({ keywords: ["react", "terraform"] })).toEqual(
      ["Frontend Developer", "Platform Engineer"].sort(),
    );
    expect(await titles({ excludedKeywords: ["terraform"] })).not.toContain("Platform Engineer");
    expect(await titles({ excludedKeywords: ["kubernetes"] })).not.toContain("Data Engineer");
  });

  it("treats LIKE wildcards in a keyword as plain characters", async () => {
    expect(await titles({ keywords: ["%"] })).toEqual([]);
    expect(await titles({ keywords: ["_"] })).toEqual([]);
  });

  it("filters by location text and by country", async () => {
    expect(await titles({ locationText: "milan" })).toEqual(["Backend Engineer"]);
    expect(await titles({ locationText: "lombardy", hideDismissed: false })).toEqual([
      "Backend Engineer",
    ]);
    expect(await titles({ countryCode: "DE" })).toEqual(["Sviluppatore Backend"]);
    expect(await titles({ countryCode: "IT", hideDismissed: false })).toEqual([
      "Backend Engineer",
      "Backend Intern",
    ]);
  });

  it("filters by remote scope text, work mode, employment type and seniority", async () => {
    expect(await titles({ remoteScope: "eu" })).toEqual(["Frontend Developer"]);
    expect(await titles({ workModes: ["remote"] })).toEqual(["Frontend Developer"]);
    expect(await titles({ workModes: ["onsite", "hybrid"] })).toEqual(
      ["Backend Engineer", "Data Engineer", "Platform Engineer", "Sviluppatore Backend"].sort(),
    );
    expect(await titles({ employmentTypes: ["contract"] })).toEqual(["Frontend Developer"]);
    expect(await titles({ employmentTypes: ["internship"], hideDismissed: false })).toEqual([
      "Backend Intern",
    ]);
    expect(await titles({ seniorities: ["junior"] })).toEqual(["Sviluppatore Backend"]);
  });

  it("compares a minimum salary only with salaries in the same currency and period", async () => {
    // Backend Engineer meets 60000 EUR a year; Sviluppatore Backend states 45000 EUR a year and is
    // left out. Jobs without a comparable salary (none, USD, EUR a month) are kept.
    const minimum = {
      min: 60000,
      currency: "EUR",
      period: "year",
      hideWithoutSalary: false,
    } as const;
    expect(await titles({ salary: minimum })).toEqual(
      ["Backend Engineer", "Data Engineer", "Frontend Developer", "Platform Engineer"].sort(),
    );
    expect(await titles({ salary: { ...minimum, hideWithoutSalary: true } })).toEqual([
      "Backend Engineer",
    ]);
    expect(
      await titles({
        salary: { min: 40000, currency: "EUR", period: "year", hideWithoutSalary: true },
      }),
    ).toEqual(["Backend Engineer", "Sviluppatore Backend"].sort());
    expect(
      await titles({
        salary: { min: 51000, currency: "EUR", period: "month", hideWithoutSalary: true },
      }),
    ).toEqual(["Platform Engineer"]);
  });

  it("filters by posted-within windows, falling back to the first-seen date when there is no posting date", async () => {
    // Sviluppatore Backend and Platform Engineer have no posting date: first seen 2 and 5 days ago.
    expect(await titles({ postedWithin: "7d" })).toEqual(
      ["Backend Engineer", "Platform Engineer", "Sviluppatore Backend"].sort(),
    );
    expect(await titles({ postedWithin: "24h" })).toEqual(["Backend Engineer"]);
    expect(await titles({ postedWithin: "any" })).toHaveLength(5);
  });

  it("filters by posting language, visa sponsorship, companies and sources", async () => {
    expect(await titles({ language: "it" })).toEqual(["Sviluppatore Backend"]);
    expect(await titles({ visaSponsorship: "yes" })).toEqual(
      ["Backend Engineer", "Platform Engineer"].sort(),
    );
    expect(await titles({ includedCompanyIds: ["c2"] })).toEqual(
      ["Data Engineer", "Sviluppatore Backend"].sort(),
    );
    expect(await titles({ excludedCompanyIds: ["c2"] })).toEqual(
      ["Backend Engineer", "Frontend Developer", "Platform Engineer"].sort(),
    );
    expect(await titles({ sources: ["lever"] })).toEqual(["Frontend Developer"]);
    expect(await titles({ sources: ["ashby"] })).toEqual(
      ["Data Engineer", "Platform Engineer", "Sviluppatore Backend"].sort(),
    );
  });

  it("filters by minimum affinity, leaving out unscored jobs", async () => {
    expect(await titles({ minScore: 60 })).toEqual(["Backend Engineer", "Data Engineer"].sort());
    expect(await titles({ minScore: 60, hideDismissed: false })).toEqual(
      ["Backend Engineer", "Backend Intern", "Data Engineer"].sort(),
    );
  });

  it("shows only jobs the user has not viewed when new-only is set, and the viewed ones again after a flag change", async () => {
    expect(await titles({ newOnly: true })).toHaveLength(5);

    await repository.setJobFlag({ jobId: "j1", viewed: true }, NOW);

    const after = await titles({ newOnly: true });
    expect(after).not.toContain("Backend Engineer");
    expect(after).toHaveLength(4);
  });

  it("combines filters: every condition must hold", async () => {
    expect(await titles({ keywords: ["backend"], workModes: ["hybrid"], minScore: 80 })).toEqual([
      "Backend Engineer",
    ]);
    expect(
      await titles({ keywords: ["backend"], countryCode: "DE", workModes: ["hybrid"] }),
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
