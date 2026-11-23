// protects=a notification click opens the job list with the new-only filter and, when the notification named one, that saved search;
// fails_when=the path drops the new-only flag, names a saved search that the notification did not name, or puts anything but the search id into the link;
// no_claim=how the list narrows once it opens is covered by the jobs screen test, not here.
import { describe, expect, it } from "vitest";
import { newJobsPath } from "./new-jobs-link";

describe("new jobs link", () => {
  it("opens only the new jobs, narrowed to the saved search when one was named", () => {
    expect(newJobsPath({ savedSearchId: "s1" })).toBe("/jobs?new=1&saved=s1");
    expect(newJobsPath({ savedSearchId: null })).toBe("/jobs?new=1");
  });
});
