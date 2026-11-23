// protects=search queries combine each keyword and location with every ATS board domain, and stay within the query cap;
// fails_when=a keyword or ATS is dropped, quotes or operators from user input reach the query, or more queries are sent than the cap allows;
// no_claim=how the search provider ranks results for these queries, which needs a live check.
import { describe, expect, it } from "vitest";
import { ATS_IDS } from "../ats/types";
import { ATS_SEARCH_SITES, buildQueries } from "./query";

describe("search query builder", () => {
  it("covers every ATS domain for a keyword without a location", () => {
    const queries = buildQueries({ keywords: ["backend engineer"], locations: [] }, 100);

    expect(queries).toHaveLength(ATS_IDS.length);
    expect(queries[0]).toBe(
      `"backend engineer" (site:boards.greenhouse.io OR site:job-boards.greenhouse.io)`,
    );
    for (const ats of ATS_IDS) {
      const sites = ATS_SEARCH_SITES[ats].map((site) => `site:${site}`).join(" OR ");
      expect(queries.some((query) => query.endsWith(`(${sites})`))).toBe(true);
    }
  });

  it("combines keywords, locations and ATS domains", () => {
    const queries = buildQueries({ keywords: ["data", "ml"], locations: ["Milan", "Berlin"] }, 100);

    expect(queries).toHaveLength(2 * 2 * ATS_IDS.length);
    expect(queries).toContain(`"ml" "Berlin" (site:jobs.lever.co)`);
  });

  it("strips quotes and operators from user terms", () => {
    const [query] = buildQueries({ keywords: [`x" OR site:evil.example "`], locations: [] }, 1);

    expect(query).toBe(
      `"x OR site:evil.example" (site:boards.greenhouse.io OR site:job-boards.greenhouse.io)`,
    );
  });

  it("stops at the query cap, keeping the first keywords", () => {
    const queries = buildQueries({ keywords: ["a", "b", "c"], locations: [] }, 10);

    expect(queries).toHaveLength(10);
    expect(queries.some((query) => query.startsWith(`"c"`))).toBe(false);
  });
});
