// protects=discovery turns result URLs into one candidate per ATS board, stops asking a source that answers with a challenge while the other sources keep running, adds the query-independent board list once per run, reports why no query succeeded, and runs only the sources its configuration enables;
// fails_when=the same board is listed twice, a challenge lets that source send more queries or stops the other sources, a failed search is reported as success, a challenged result is not flagged as searchBlocked, the board list is read per query, or a disabled source runs;
// no_claim=search ranking and live provider behaviour, and the HTTP queue timing, which the HTTP client's own tests cover.
import { describe, expect, it } from "vitest";
import { discoverCompanies, searchSourcesFor } from "./discover";
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
const noBoardSources = { boardSources: [] };
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

    const outcome = await discoverCompanies(criteria, { http, sources: [source], maxQueries: 1, ...noBoardSources });

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

    const outcome = await discoverCompanies(criteria, { http, sources: [source], ...noBoardSources });

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

    const outcome = await discoverCompanies(criteria, { http, sources: [source], ...noBoardSources });

    expect(outcome).toEqual({
      ok: true,
      searchBlocked: true,
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

    const outcome = await discoverCompanies(criteria, { http, sources: [source], maxQueries: 3, ...noBoardSources });

    expect(outcome).toEqual({ ok: false, code: "search-failed" });
  });

  it("keeps asking the other sources when one answers with a challenge", async () => {
    const blocked = scriptedSource(() => ({ ok: false, code: "blocked" }));
    const keyed = scriptedSource(() => ({ ok: true, urls: ["https://jobs.lever.co/globex/1"] }));

    const outcome = await discoverCompanies(criteria, {
      http,
      sources: [blocked.source, keyed.source],
      maxQueries: 3,
      ...noBoardSources,
    });

    expect(blocked.queries).toHaveLength(1);
    expect(keyed.queries).toHaveLength(3);
    expect(outcome).toEqual({
      ok: true,
      searchBlocked: true,
      candidates: [
        { ats: "lever", slug: "globex", careersUrl: "https://jobs.lever.co/globex", name: "globex" },
      ],
    });
  });

  it("reads the board sources once per run, whatever the number of queries", async () => {
    const { source } = scriptedSource(() => ({ ok: false, code: "network" }));
    let boardReads = 0;
    const boards = {
      id: "scripted-boards",
      async urls() {
        boardReads += 1;
        return { ok: true as const, urls: ["https://apply.workable.com/initech"] };
      },
    };

    const outcome = await discoverCompanies(criteria, {
      http,
      sources: [source],
      boardSources: [boards],
      maxQueries: 4,
    });

    expect(boardReads).toBe(1);
    expect(outcome).toEqual({
      ok: true,
      candidates: [
        {
          ats: "workable",
          slug: "initech",
          careersUrl: "https://apply.workable.com/initech",
          name: "initech",
        },
      ],
    });
  });

  it("lists the enabled search sources only, in the order DuckDuckGo then keyed", () => {
    const names = (config: Parameters<typeof searchSourcesFor>[0]) =>
      searchSourcesFor(config).map((source) => source.id);

    expect(names({ duckduckgo: false, keyed: [] })).toEqual([]);
    expect(names({ duckduckgo: true, keyed: [] })).toEqual(["duckduckgo-html"]);
    expect(
      names({
        duckduckgo: false,
        keyed: [
          { provider: "serper", apiKey: "k" },
          { provider: "brave", apiKey: "k" },
        ],
      }),
    ).toEqual(["keyed-serper", "keyed-brave"]);
  });
});
