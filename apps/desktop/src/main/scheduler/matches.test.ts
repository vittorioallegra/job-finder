// protects=new matches are the distinct jobs first seen at or after the run's start that match a saved search, with the best score and the one saved search they came from when there is exactly one;
// fails_when=a job seen before the run is counted, a job matching two searches is counted twice, a job is counted from a search it does not match, the top score ignores scored jobs, or a single saved search is not named as the click target;
// no_claim=the filter's SQL and the scores of jobs are the job repository's; this test feeds the job list directly.
import { describe, expect, it } from "vitest";
import type { JobFilter, JobListItem, SavedSearch } from "@job-finder/bridge";
import { findNewMatches } from "./matches";

const job = (id: string, firstSeenAt: number, score: number | null = null): JobListItem =>
  ({ id, firstSeenAt, score }) as unknown as JobListItem;

const search = (id: string, name: string): SavedSearch => ({
  id,
  name,
  filter: {} as JobFilter as SavedSearch["filter"],
  updatedAt: 0,
});

describe("new job matches", () => {
  it("counts distinct new jobs across searches, with the best score and the searches that matched", async () => {
    const byFilter = new Map<JobFilter, JobListItem[]>();
    const backend = search("s1", "Backend");
    const data = search("s2", "Data");
    byFilter.set(backend.filter, [job("a", 100, 70), job("shared", 100, 60), job("old", 1)]);
    byFilter.set(data.filter, [job("shared", 100, 60), job("b", 120, 88)]);

    const result = await findNewMatches(
      [backend, data],
      50,
      async (filter) => byFilter.get(filter) ?? [],
    );

    expect(result).toEqual({
      count: 3,
      topScore: 88,
      searchNames: ["Backend", "Data"],
      savedSearchId: null,
    });
  });

  it("names the one saved search as the click target, and reports no score when nothing is scored", async () => {
    const backend = search("s1", "Backend");
    const result = await findNewMatches([backend], 50, async () => [job("a", 100)]);
    expect(result).toEqual({
      count: 1,
      topScore: null,
      searchNames: ["Backend"],
      savedSearchId: "s1",
    });
  });

  it("reports nothing when every match was seen before the run", async () => {
    const result = await findNewMatches([search("s1", "Backend")], 500, async () => [
      job("a", 100),
    ]);
    expect(result).toEqual({ count: 0, topScore: null, searchNames: [], savedSearchId: null });
  });
});
