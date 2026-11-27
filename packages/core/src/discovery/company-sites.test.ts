// protects=the web search is also asked for companies with their own careers site (careers pages in the places' languages and sector queries), its result sites are read for their careers page, job-list sites, ATS boards and followed or already read sites are left out, and a blocked source is not asked again;
// fails_when=only ATS boards are asked for, a job aggregator or an ATS URL is read as a company, a followed site is looked up again, a site is read twice in a session, a challenge still lets that source send queries, or the careers wording of the place is dropped;
// no_claim=what a live search engine returns for these queries and the live sites, which only a live check shows;
import { describe, expect, it } from "vitest";
import { createHttpClient } from "../net";
import { companyQueries, discoverCompanySites, nameFromHost } from "./company-sites";
import type { SearchSource } from "./source";

describe("company queries", () => {
  it("asks for careers pages in the local and English wording, and for the sector, per place", () => {
    const queries = companyQueries({ keywords: ["software engineer"], locations: ["Milano"] }, 20);
    expect(
      queries.some((query) => query.includes('"lavora con noi"') && query.includes('"Milano"')),
    ).toBe(true);
    expect(queries.some((query) => query.includes('"careers"'))).toBe(true);
    expect(queries.some((query) => query.includes("system integrator"))).toBe(true);
    expect(queries.every((query) => query.includes("-site:linkedin.com"))).toBe(true);
    expect(companyQueries({ keywords: ["a"], locations: ["Milano"] }, 3)).toHaveLength(3);
  });

  it("names a company from its host", () => {
    expect(nameFromHost("www.orbyta.it")).toBe("Orbyta");
    expect(nameFromHost("careers.soprasteria.it")).toBe("Soprasteria");
    expect(nameFromHost("acme.co.uk")).toBe("Acme");
  });
});

describe("company sites", () => {
  const html = (body: string) => new Response(`<html><body>${body}</body></html>`);
  function client(requests: string[]) {
    return createHttpClient({
      fetch: (async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.pathname === "/robots.txt") return new Response("", { status: 404 });
        requests.push(url.hostname);
        return html('<a href="/lavora-con-noi">Lavora con noi</a>');
      }) as typeof fetch,
      intervalMs: 0,
      sleep: async () => {},
      maxAttempts: 1,
    });
  }

  it("reads each result site once for its careers page and skips aggregators, boards and followed sites", async () => {
    const requests: string[] = [];
    const source: SearchSource = {
      id: "scripted",
      async search() {
        return {
          ok: true,
          urls: [
            "https://www.orbyta.it/career/",
            "https://it.linkedin.com/jobs/x",
            "https://jobs.lever.co/globex/1",
            "https://followed.example/careers",
          ],
        };
      },
    };
    const criteria = {
      keywords: ["developer"],
      locations: ["Milano"],
      known: ["followed.example"],
    };
    const first = await discoverCompanySites(
      criteria,
      [source],
      { http: client(requests) },
      new Set(),
    );
    expect(first.candidates.map((candidate) => candidate.name)).toEqual(["Orbyta"]);
    expect(first.boardUrls).toEqual(["https://jobs.lever.co/globex/1"]);
    expect(first.candidates[0]?.careersUrl).toBe("https://www.orbyta.it/lavora-con-noi");
    expect(requests.filter((host) => host === "www.orbyta.it").length).toBeGreaterThan(0);
    expect(requests.some((host) => host.includes("linkedin") || host === "followed.example")).toBe(
      false,
    );

    const before = requests.length;
    const second = await discoverCompanySites(
      criteria,
      [source],
      { http: client(requests) },
      new Set(),
    );
    expect(second.candidates).toEqual([]);
    expect(requests.length).toBe(before);
  });

  it("stops asking a source that answers with a challenge", async () => {
    let asked = 0;
    const source: SearchSource = {
      id: "blocked",
      async search() {
        asked += 1;
        return { ok: false, code: "blocked" };
      },
    };
    const result = await discoverCompanySites(
      { keywords: ["developer"], locations: ["Roma"] },
      [source],
      { http: client([]) },
      new Set(),
    );
    expect(asked).toBe(1);
    expect(result).toMatchObject({ blocked: true, answered: 0, candidates: [] });
  });
});
