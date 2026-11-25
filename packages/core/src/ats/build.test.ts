// protects=a posting that says "Remote" without a scope but whose description requires work authorization in a country gets that country as its remote scope, keeps a stated scope, and leaves an open remote job without one;
// fails_when=the description's country is ignored for a remote job, it overrides a scope stated in the location, it is applied to an on-site job, or an open description gets a scope;
// no_claim=how the scope is used to filter jobs (the SQL filter tests cover that) and the adapters that call buildJob;
import { describe, expect, it } from "vitest";
import { normalizeLocation } from "../normalize";
import { buildJob, type JobInput } from "./build";

const US_TEXT =
  "Applicants must be authorized to work in the United States. Certain roles may require U.S. citizenship and a security clearance.";

function input(overrides: Partial<JobInput>): JobInput {
  return {
    source: "greenhouse",
    sourceJobId: "1",
    url: "https://boards.greenhouse.io/oddball/jobs/1",
    companyName: "Oddball",
    title: "Engineer",
    description: "Build things.",
    locations: [normalizeLocation("Remote")],
    ...overrides,
  };
}

describe("job scope from the description", () => {
  it("gives a remote job the country its description requires work authorization in", () => {
    expect(buildJob(input({ description: US_TEXT })).remoteScope).toBe("United States");
  });

  it("keeps the scope the location states, ignores the description for an on-site job, and leaves an open job alone", () => {
    expect(
      buildJob(input({ description: US_TEXT, locations: [normalizeLocation("Remote - EU")] }))
        .remoteScope,
    ).toBe("EU");
    expect(
      buildJob(input({ description: US_TEXT, locations: [normalizeLocation("Austin, TX")] }))
        .remoteScope,
    ).toBeUndefined();
    expect(buildJob(input({})).remoteScope).toBeUndefined();
  });
});
