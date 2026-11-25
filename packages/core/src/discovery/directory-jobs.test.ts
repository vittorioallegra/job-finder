// protects=Workable directory postings become normalized jobs with their company, description, place and workplace, pages are followed to the end or the cap, a posting that does not parse is skipped, and a place with no country or city or a failing directory gives nothing;
// fails_when=a remote posting loses its remote mode, the company or country is dropped, a second page is not read, one bad posting empties the result, or an unreachable directory throws;
// no_claim=the real directory's answers: the payloads here are small hand-made copies of its shape;
import { describe, expect, it } from "vitest";
import { createHttpClient } from "../net";
import { directoryJobs } from "./directory-jobs";

const posting = (id: string, extra: object = {}) => ({
  id,
  title: `Engineer ${id}`,
  description: "<p>Build things.</p>",
  requirementsSection: "<ul><li>Python</li></ul>",
  employmentType: "Full-time",
  url: `https://jobs.workable.com/view/${id}`,
  locations: ["Milan, Italy"],
  location: { city: "Milan", subregion: null, countryName: "Italy" },
  created: "2026-11-20T10:00:00.000Z",
  workplace: "on_site",
  company: { title: "Acme Srl" },
  ...extra,
});

function client(pages: Array<object | number>) {
  const urls: string[] = [];
  let index = 0;
  const fetchFake = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/robots.txt") return new Response("", { status: 404 });
    urls.push(url.toString());
    const page = pages[index++];
    if (typeof page === "number") return new Response("no", { status: page });
    return new Response(JSON.stringify(page ?? { jobs: [] }), { status: 200 });
  }) as typeof fetch;
  return {
    http: createHttpClient({
      fetch: fetchFake,
      intervalMs: 0,
      sleep: async () => {},
      maxAttempts: 1,
    }),
    urls,
  };
}

describe("Workable directory postings", () => {
  it("reads every page, keeps the company, text, place and remote mode, and skips a posting that does not parse", async () => {
    const { http, urls } = client([
      { jobs: [posting("a"), { broken: true }], nextPageToken: "next" },
      { jobs: [posting("b", { workplace: "remote", locations: ["TELECOMMUTE", "Italy"] })] },
    ]);

    const jobs = await directoryJobs({ keywords: ["engineer"], locations: ["Italia"] }, { http });

    expect(jobs.map((job) => job.sourceJobId)).toEqual(["a", "b"]);
    expect(urls[0]).toContain("location=Italy");
    expect(urls[0]).toContain("query=engineer");
    expect(urls[1]).toContain("pageToken=next");
    expect(jobs[0]).toMatchObject({
      companyName: "Acme Srl",
      title: "Engineer a",
      source: "workable-directory",
    });
    expect(jobs[0]?.description).toContain("Build things");
    expect(jobs[0]?.description).toContain("Python");
    expect(jobs[0]?.locations[0]?.countryCode).toBe("IT");
    expect(jobs[1]?.workMode).toBe("remote");
  });

  it("gives nothing for a place that is neither a country nor a city, or when the directory fails", async () => {
    expect(await directoryJobs({ keywords: [], locations: [] }, { http: client([]).http })).toEqual(
      [],
    );
    expect(
      await directoryJobs({ keywords: [], locations: ["Italy"] }, { http: client([500]).http }),
    ).toEqual([]);
  });
});
