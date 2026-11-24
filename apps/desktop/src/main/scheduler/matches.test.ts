// protects=new matches are the jobs first seen at or after the run's start that match the profile's filter, with the best score among them;
// fails_when=a job seen before the run is counted, the top score ignores scored jobs, or a run with nothing new reports a count;
// no_claim=the filter's SQL and the scores of jobs are the job repository's; this test feeds the job list directly.
import { describe, expect, it } from "vitest";
import { DEFAULT_JOB_FILTER, type JobListItem } from "@job-finder/bridge";
import { findNewMatches } from "./matches";

const job = (id: string, firstSeenAt: number, score: number | null = null): JobListItem =>
  ({ id, firstSeenAt, score }) as unknown as JobListItem;

describe("new job matches", () => {
  it("counts the jobs first seen since the run started, with the best score", async () => {
    const result = await findNewMatches(DEFAULT_JOB_FILTER, 50, async () => [
      job("a", 100, 70),
      job("b", 120, 88),
      job("old", 1, 95),
    ]);
    expect(result).toEqual({ count: 2, topScore: 88 });
  });

  it("reports no score when nothing is scored", async () => {
    const result = await findNewMatches(DEFAULT_JOB_FILTER, 50, async () => [job("a", 100)]);
    expect(result).toEqual({ count: 1, topScore: null });
  });

  it("reports nothing when every job was seen before the run", async () => {
    const result = await findNewMatches(DEFAULT_JOB_FILTER, 500, async () => [job("a", 100)]);
    expect(result).toEqual({ count: 0, topScore: null });
  });
});
