// protects=Himalayas and Arbeitnow postings become jobs with their company, text and the countries a remote posting is open to, only those in the places are kept, and a feed that fails or sends malformed postings gives nothing;
// fails_when=a remote posting closed to another country is kept, a posting loses its company, one malformed posting empties the feed, or a failing feed throws;
// no_claim=the real feeds' volume and wording: the payloads are small hand-made copies of their shape;
import { describe, expect, it } from "vitest";
import { createHttpClient } from "../net";
import { arbeitnowJobs, himalayasJobs } from "./feed-jobs";

function client(answers: Array<unknown | number>) {
  let index = 0;
  const urls: string[] = [];
  const fetchFake = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/robots.txt") return new Response("", { status: 404 });
    urls.push(url.toString());
    const answer = answers[index++];
    if (typeof answer === "number") return new Response("no", { status: answer });
    return new Response(JSON.stringify(answer ?? { jobs: [], data: [] }), { status: 200 });
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

const himalayas = (title: string, restrictions: string[]) => ({
  title,
  companyName: "Acme",
  employmentType: "Full Time",
  locationRestrictions: restrictions,
  description: "<p>Remote work.</p>",
  pubDate: 1795625632,
  applicationLink: `https://himalayas.app/companies/acme/jobs/${title}`,
  guid: `https://himalayas.app/companies/acme/jobs/${title}`,
});

describe("job feeds", () => {
  it("keeps Himalayas postings open to the country, with company and text, and skips malformed ones", async () => {
    const { http, urls } = client([
      { jobs: [himalayas("a", ["Italy"]), himalayas("b", ["United States"]), { broken: 1 }] },
      { jobs: [] },
    ]);

    const jobs = await himalayasJobs({ keywords: [], locations: ["Italia"] }, { http });

    expect(jobs.map((job) => job.title)).toEqual(["a"]);
    expect(jobs[0]).toMatchObject({ companyName: "Acme", source: "himalayas", workMode: "remote" });
    expect(urls[0]).toContain("country=Italy");
  });

  it("keeps Arbeitnow postings located in the places, and nothing when the feed fails", async () => {
    const posting = (slug: string, location: string) => ({
      slug,
      company_name: "Konfetti GmbH",
      title: slug,
      description: "<p>Hallo</p>",
      remote: false,
      url: `https://www.arbeitnow.com/jobs/${slug}`,
      location,
      created_at: 1795626056,
    });
    const { http } = client([
      { data: [posting("a", "Berlin, Germany"), posting("b", "Milan, Italy")] },
      { data: [] },
    ]);

    const jobs = await arbeitnowJobs({ keywords: [], locations: ["Germany"] }, { http });
    expect(jobs.map((job) => job.title)).toEqual(["a"]);

    expect(
      await arbeitnowJobs({ keywords: [], locations: ["Germany"] }, { http: client([500]).http }),
    ).toEqual([]);
    expect(
      await himalayasJobs({ keywords: [], locations: ["Italia"] }, { http: client([500]).http }),
    ).toEqual([]);
  });
});
