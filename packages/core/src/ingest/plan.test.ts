// protects=a batch stores a posting once even when two sources report it, keeps two openings of one source apart, and updates postings it has already stored instead of inserting them again;
// fails_when=one opening from two sources gets two jobs, two openings of one source collapse into one job, a known posting is inserted again, or a repeated posting in one batch writes twice;
// no_claim=the planner does not read the database: the SQL that applies these writes and the closing of missing postings are covered by the desktop tests.
import { describe, expect, it } from "vitest";
import type { NormalizedJob } from "../normalize";
import { planBatch, type ExistingState } from "./plan";

function job(overrides: Partial<NormalizedJob>): NormalizedJob {
  return {
    source: "greenhouse",
    sourceJobId: "1",
    url: "https://example.test/1",
    applyUrl: "https://example.test/1/apply",
    companyName: "Acme",
    title: "Backend Engineer",
    description: "Build things.",
    locations: [{ raw: "Milan, Italy", city: "Milan", countryCode: "IT" }],
    workMode: "unknown",
    employmentType: "unknown",
    seniority: "unknown",
    visaSponsorship: "unknown",
    ...overrides,
  };
}

const empty: ExistingState = { jobs: [], sources: [] };

function ids(prefix: string): () => string {
  let next = 0;
  return () => `${prefix}-${++next}`;
}

describe("planBatch", () => {
  it("stores a new posting as one job with its source row", () => {
    const plan = planBatch({
      companyId: "co-1",
      runId: "run-1",
      seenAt: 100,
      jobs: [job({})],
      existing: empty,
      newId: ids("job"),
    });

    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).toMatchObject({ id: "job-1", companyId: "co-1" });
    expect(plan.touches).toEqual([]);
    expect(plan.sources).toEqual([
      {
        source: "greenhouse",
        sourceJobId: "1",
        jobId: "job-1",
        companyId: "co-1",
        url: "https://example.test/1",
        applyUrl: "https://example.test/1/apply",
        runId: "run-1",
      },
    ]);
  });

  it("stores one opening reported by two sources once, with both source rows on that job", () => {
    const plan = planBatch({
      companyId: "co-1",
      runId: "run-1",
      seenAt: 100,
      jobs: [
        job({ source: "greenhouse", sourceJobId: "1" }),
        job({ source: "lever", sourceJobId: "abc", url: "https://jobs.lever.co/acme/abc" }),
      ],
      existing: empty,
      newId: ids("job"),
    });

    expect(plan.inserts.map((insert) => insert.id)).toEqual(["job-1"]);
    expect(plan.sources.map((source) => source.jobId)).toEqual(["job-1", "job-1"]);
  });

  it("keeps two openings of one source apart when they share a title and location", () => {
    const plan = planBatch({
      companyId: "co-1",
      runId: "run-1",
      seenAt: 100,
      jobs: [job({ sourceJobId: "1" }), job({ sourceJobId: "2" })],
      existing: empty,
      newId: ids("job"),
    });

    expect(plan.inserts.map((insert) => insert.id)).toEqual(["job-1", "job-2"]);
    expect(plan.sources.map((source) => source.jobId)).toEqual(["job-1", "job-2"]);
  });

  it("updates a posting the store already has instead of inserting it again", () => {
    const plan = planBatch({
      companyId: "co-1",
      runId: "run-2",
      seenAt: 200,
      jobs: [job({ sourceJobId: "1" })],
      existing: {
        jobs: [{ id: "job-x", fingerprint: "unused", sources: ["greenhouse"] }],
        sources: [{ source: "greenhouse", sourceJobId: "1", jobId: "job-x" }],
      },
      newId: ids("job"),
    });

    expect(plan.inserts).toEqual([]);
    expect(plan.touches).toEqual(["job-x"]);
    expect(plan.sources).toMatchObject([{ jobId: "job-x", runId: "run-2" }]);
  });

  it("joins a posting from a new source to a stored job with the same fingerprint", () => {
    const stored = planBatch({
      companyId: "co-1",
      runId: "run-1",
      seenAt: 100,
      jobs: [job({ source: "greenhouse", sourceJobId: "1" })],
      existing: empty,
      newId: ids("job"),
    });
    const storedJob = stored.inserts[0];
    if (!storedJob) throw new Error("expected one insert");

    const plan = planBatch({
      companyId: "co-1",
      runId: "run-2",
      seenAt: 200,
      jobs: [job({ source: "lever", sourceJobId: "abc" })],
      existing: {
        jobs: [
          {
            id: storedJob.id,
            fingerprint: storedJob.fingerprint,
            sources: ["greenhouse"],
          },
        ],
        sources: [{ source: "greenhouse", sourceJobId: "1", jobId: storedJob.id }],
      },
      newId: ids("job"),
    });

    expect(plan.inserts).toEqual([]);
    expect(plan.touches).toEqual([storedJob.id]);
    expect(plan.sources).toMatchObject([{ source: "lever", jobId: storedJob.id }]);
  });

  it("counts a posting repeated inside one batch once", () => {
    const plan = planBatch({
      companyId: "co-1",
      runId: "run-1",
      seenAt: 100,
      jobs: [job({ sourceJobId: "1" }), job({ sourceJobId: "1", title: "Senior Engineer" })],
      existing: empty,
      newId: ids("job"),
    });

    expect(plan.inserts).toHaveLength(1);
    expect(plan.sources).toHaveLength(1);
  });
});
