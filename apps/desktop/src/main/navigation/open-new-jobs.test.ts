// protects=a notification click is delivered to the window and kept until a window takes it, so a click made while the window is loading or hidden still opens the jobs once;
// fails_when=a request is lost when no window was ready, a request is taken twice, or a delivered request is not cleared;
// no_claim=whether the renderer has subscribed in time is not known here; the renderer also takes the waiting request on load.
import { describe, expect, it } from "vitest";
import type { OpenNewJobsRequest } from "@job-finder/bridge";
import { createOpenNewJobsRelay } from "./open-new-jobs";

describe("open new jobs relay", () => {
  it("delivers a click and keeps it until a window takes it, once", () => {
    const delivered: OpenNewJobsRequest[] = [];
    const relay = createOpenNewJobsRelay((request) => delivered.push(request));

    expect(relay.take()).toBeNull();
    relay.open({ savedSearchId: "s1" });
    expect(delivered).toEqual([{ savedSearchId: "s1" }]);
    expect(relay.take()).toEqual({ savedSearchId: "s1" });
    expect(relay.take()).toBeNull();
  });
});
