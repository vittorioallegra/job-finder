// protects=a wide scan reads a slice of the community board lists that wraps around their end, skips boards already followed, keeps only the postings in the places, tolerates a board that fails or a list that is down, and does nothing without a slice;
// fails_when=a posting outside the places is kept, a followed board is read again, the next slice does not advance or wrap, one failing board stops the scan, or a down list reads as an empty answer;
// no_claim=the real lists and the real board APIs: both are scripted here, so how many boards the lists hold and how fast the APIs answer is not shown;
import { describe, expect, it } from "vitest";
import { createHttpClient } from "../net";
import { wideBoards, wideScan } from "./wide-scan";

function web(lists: Record<string, string[] | number>, boards: Record<string, unknown>) {
  const requests: string[] = [];
  const fetchFake = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/robots.txt") return new Response("", { status: 404 });
    requests.push(url.toString());
    const file = url.pathname.split("/").pop() ?? "";
    if (file in lists) {
      const list = lists[file];
      return typeof list === "number"
        ? new Response("no", { status: list })
        : new Response(JSON.stringify(list), { status: 200 });
    }
    const board = boards[url.pathname];
    return board === undefined
      ? new Response("no", { status: 404 })
      : new Response(JSON.stringify(board), { status: 200 });
  }) as typeof fetch;
  return {
    http: createHttpClient({
      fetch: fetchFake,
      intervalMs: 0,
      sleep: async () => {},
      maxAttempts: 1,
    }),
    requests,
  };
}

const greenhouseBoard = (titles: Array<[string, string]>) => ({
  jobs: titles.map(([title, location], index) => ({
    id: index + 1,
    title,
    absolute_url: `https://boards.greenhouse.io/x/jobs/${index + 1}`,
    location: { name: location },
    content: "",
    updated_at: "2026-11-01T00:00:00Z",
  })),
});

describe("wide scan", () => {
  it("lists the boards of every list that answers, and nothing when none does", async () => {
    const some = web({ "greenhouse_companies.json": ["a", "b"], "lever_companies.json": 500 }, {});
    expect(await wideBoards({ http: some.http })).toEqual([
      { ats: "greenhouse", slug: "a" },
      { ats: "greenhouse", slug: "b" },
    ]);
    const none = web({}, {});
    expect(await wideBoards({ http: none.http })).toBeUndefined();
  });

  it("keeps only postings in the places, skips followed boards, and moves the slice on, wrapping", async () => {
    const { http, requests } = web(
      {
        "greenhouse_companies.json": ["alpha", "beta", "gamma"],
        "lever_companies.json": [],
        "ashby_companies.json": [],
      },
      {
        "/v1/boards/alpha/jobs": greenhouseBoard([
          ["Engineer", "Milan, Italy"],
          ["Engineer US", "Austin, TX, United States"],
        ]),
        "/v1/boards/gamma/jobs": greenhouseBoard([["Designer", "Rome, Italy"]]),
      },
    );

    const first = await wideScan(
      {
        keywords: [],
        locations: ["Italia"],
        wide: { offset: 0, count: 2 },
        knownBoards: ["greenhouse/beta"],
      },
      { http },
    );

    // The slice holds two boards that are not followed: alpha and gamma, so it ends past beta.
    expect(first?.jobs.map((job) => job.title).sort()).toEqual(["Designer", "Engineer"]);
    expect(first?.next).toBe(0);
    expect(requests.some((url) => url.includes("/beta/"))).toBe(false);

    const wrapped = await wideScan(
      { keywords: [], locations: ["Italia"], wide: { offset: 2, count: 1 } },
      { http },
    );
    expect(wrapped?.jobs.map((job) => job.title)).toEqual(["Designer"]);
    expect(wrapped?.next).toBe(0);
  });

  it("skips boards it was told to skip, and reports boards that are gone or empty for the places", async () => {
    const { http, requests } = web(
      {
        "greenhouse_companies.json": ["alpha", "gone", "empty", "skipped"],
        "lever_companies.json": [],
        "ashby_companies.json": [],
      },
      {
        "/v1/boards/alpha/jobs": greenhouseBoard([["Engineer", "Milan, Italy"]]),
        "/v1/boards/empty/jobs": greenhouseBoard([["Engineer US", "Austin, TX, United States"]]),
      },
    );

    const result = await wideScan(
      {
        keywords: [],
        locations: ["Italia"],
        wide: { offset: 0, count: 10 },
        skipBoards: ["greenhouse/skipped"],
      },
      { http },
    );

    expect(result?.jobs.map((job) => job.title)).toEqual(["Engineer"]);
    expect(result?.checked).toEqual(
      expect.arrayContaining([
        { board: "greenhouse/gone", kind: "dead" },
        { board: "greenhouse/empty", kind: "idle" },
      ]),
    );
    expect(result?.checked).toHaveLength(2);
    expect(requests.some((url) => url.includes("/skipped/"))).toBe(false);
  });

  it("does nothing without a slice", async () => {
    expect(
      await wideScan({ keywords: [], locations: [] }, { http: web({}, {}).http }),
    ).toBeUndefined();
  });
});
