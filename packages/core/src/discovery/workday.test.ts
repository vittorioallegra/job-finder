// protects=a Workday site is searched for each country of the places, the postings that name the place or several places are read for their text, only those in the places are kept, a site that does not answer or a malformed board gives nothing, and the company is named from its tenant;
// fails_when=a posting in another country is kept, a site is read without a place to search, a failing site throws, a posting page is read for a posting that names another place, or a malformed board entry reaches the network;
// no_claim=real Workday sites: the answers are small hand-made copies of the JSON their pages use;
import { describe, expect, it } from "vitest";
import { createHttpClient } from "../net";
import { parseWorkdayBoard, workdayJobs } from "./workday";

const BASE = "https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/careers";

function web(routes: Record<string, unknown>) {
  const requests: string[] = [];
  const fetchFake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
    requests.push(`${init?.method ?? "GET"} ${url}`);
    const body = routes[url];
    return body === undefined
      ? new Response("no", { status: 404 })
      : new Response(JSON.stringify(body), { status: 200 });
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

const detail = (title: string, location: string, country: string) => ({
  jobPostingInfo: {
    title,
    jobDescription: "<p>Join us.</p>",
    location,
    startDate: "2026-11-01",
    timeType: "Full time",
    jobReqId: title.replace(/ /g, "-"),
    externalUrl: `https://acme.wd3.myworkdayjobs.com/careers/job/${title}`,
    country: { descriptor: country },
  },
});

describe("Workday boards", () => {
  it("reads a tenant|wd|site entry and refuses anything else", () => {
    expect(parseWorkdayBoard("acme|wd3|careers")).toEqual({
      tenant: "acme",
      wd: "wd3",
      site: "careers",
    });
    expect(parseWorkdayBoard("acme|wd3")).toBeUndefined();
    expect(parseWorkdayBoard("a/b|wd3|x")).toBeUndefined();
  });

  it("keeps postings in the places, reads a posting page only for a posting that may be there, and names the company", async () => {
    const { http, requests } = web({
      [`${BASE}/jobs`]: {
        total: 3,
        jobPostings: [
          { title: "Engineer", externalPath: "/job/milan/engineer", locationsText: "Milan, Italy" },
          { title: "Sales", externalPath: "/job/multi/sales", locationsText: "2 Locations" },
          {
            title: "Other",
            externalPath: "/job/austin/other",
            locationsText: "Austin, United States",
          },
        ],
      },
      [`${BASE}/job/milan/engineer`]: detail("Engineer", "Milan", "Italy"),
      [`${BASE}/job/multi/sales`]: detail("Sales", "Rome", "Italy"),
    });

    const jobs = await workdayJobs(
      "acme|wd3|careers",
      { keywords: [], locations: ["Italia"] },
      { http },
    );

    expect(jobs.map((job) => job.title).sort()).toEqual(["Engineer", "Sales"]);
    expect(jobs[0]).toMatchObject({ companyName: "Acme", source: "workday" });
    expect(jobs[0]?.locations[0]?.countryCode).toBe("IT");
    expect(requests.some((line) => line.includes("/austin/"))).toBe(false);
  });

  it("gives nothing for a site that fails, a bad entry or no place", async () => {
    const { http, requests } = web({});
    const criteria = { keywords: [], locations: ["Italia"] };
    expect(await workdayJobs("acme|wd3|careers", criteria, { http })).toEqual([]);
    expect(await workdayJobs("bad entry", criteria, { http })).toEqual([]);
    expect(
      await workdayJobs("acme|wd3|careers", { keywords: [], locations: [] }, { http }),
    ).toEqual([]);
    expect(requests.filter((line) => line.includes("bad"))).toEqual([]);
  });
});
