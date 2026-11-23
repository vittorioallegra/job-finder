// protects=discovery turns result URLs into one candidate per ATS board, stops at a bot challenge without asking again, and reports why no query succeeded;
// fails_when=the same board is listed twice, a challenge lets the run send more queries, a failed search is reported as success, or a non-board URL becomes a candidate;
// no_claim=search ranking and live provider behaviour, and the HTTP queue timing, which the HTTP client's own tests cover.
import { describe, expect, it } from "vitest";
import { discoverCompanies } from "./discover";
import type { SearchResult, SearchSource } from "./source";

function scriptedSource(answer: (query: string) => SearchResult) {
  const queries: string[] = [];
  const source: SearchSource = {
    id: "scripted",
    async search(query) {
      queries.push(query);
      return answer(query);
    },
  };
  return { source, queries };
}

// No network: discovery only reads the URLs it is given. The HTTP client is never used here.
const http = {} as Parameters<typeof discoverCompanies>[1]["http"];
const criteria = { keywords: ["engineer"], locations: [] };

describe("company discovery", () => {
  it("returns one candidate per board, with the canonical careers address", async () => {
    const { source } = scriptedSource(() => ({
      ok: true,
      urls: [
        "https://boards.greenhouse.io/acme/jobs/1",
        "https://boards.greenhouse.io/acme/jobs/2",
        "https://jobs.lever.co/globex/abc",
        "https://example.com/careers",
      ],
    }));

    const outcome = await discoverCompanies(criteria, { http, sources: [source], maxQueries: 1 });

    expect(outcome).toEqual({
      ok: true,
      candidates: [
        {
          ats: "greenhouse",
          slug: "acme",
          careersUrl: "https://boards.greenhouse.io/acme",
          name: "acme",
        },
        {
          ats: "lever",
          slug: "globex",
          careersUrl: "https://jobs.lever.co/globex",
          name: "globex",
        },
      ],
    });
  });

  it("stops at the first challenge and reports it as blocked when nothing was found", async () => {
    const { source, queries } = scriptedSource(() => ({ ok: false, code: "blocked" }));

    const outcome = await discoverCompanies(criteria, { http, sources: [source] });

    expect(outcome).toEqual({ ok: false, code: "search-blocked" });
    expect(queries).toHaveLength(1);
  });

  it("keeps the boards found before a challenge", async () => {
    let calls = 0;
    const { source, queries } = scriptedSource(() => {
      calls += 1;
      return calls === 1
        ? { ok: true, urls: ["https://jobs.ashbyhq.com/initech"] }
        : { ok: false, code: "blocked" };
    });

    const outcome = await discoverCompanies(criteria, { http, sources: [source] });

    expect(outcome).toEqual({
      ok: true,
      candidates: [
        {
          ats: "ashby",
          slug: "initech",
          careersUrl: "https://jobs.ashbyhq.com/initech",
          name: "initech",
        },
      ],
    });
    expect(queries).toHaveLength(2);
  });

  it("reports a failure when every query failed without a challenge", async () => {
    const { source } = scriptedSource(() => ({ ok: false, code: "network" }));

    const outcome = await discoverCompanies(criteria, { http, sources: [source], maxQueries: 3 });

    expect(outcome).toEqual({ ok: false, code: "search-failed" });
  });
});
