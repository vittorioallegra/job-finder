// protects=adapters read boards through the shared HTTP client, follow every page, and never return partial jobs after a failure or an unknown slug;
// fails_when=an adapter calls fetch itself, a large company's board is refused as too large, a 404 board is not reported as gone, stops after the first page, returns the jobs read before a failing page, accepts a slug that changes the URL, or reports a failure as success;
// no_claim=rate limits, robots.txt and backoff, which the HTTP client's own tests cover, and real provider responses, which are never requested here.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createHttpClient } from "../net";
import { ATS_ADAPTERS, isValidSlug } from "./index";

const greenhouseBody = readFileSync(new URL("./fixtures/greenhouse.json", import.meta.url), "utf8");

interface Route {
  status?: number;
  body: string;
}

/** A scripted fetch: `route` answers by URL, and every request is recorded. */
function scripted(route: (url: URL) => Route | undefined) {
  const requests: string[] = [];
  const fetchFake = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requests.push(url.toString());
    if (url.pathname === "/robots.txt") return new Response("", { status: 404 });
    const answer = route(url);
    if (!answer) return new Response("unexpected", { status: 500 });
    return new Response(answer.body, { status: answer.status ?? 200 });
  }) as typeof fetch;
  const client = createHttpClient({
    fetch: fetchFake,
    intervalMs: 0,
    sleep: async () => {},
    maxAttempts: 1,
  });
  return { client, requests };
}

describe("adapter fetch", () => {
  it("reads through the HTTP client against the provider's own host", async () => {
    const { client, requests } = scripted((url) =>
      url.host === "boards-api.greenhouse.io" ? { body: greenhouseBody } : undefined,
    );
    const result = await ATS_ADAPTERS.greenhouse.fetchJobs(
      { ats: "greenhouse", slug: "stripe" },
      client,
    );
    expect(result.ok).toBe(true);
    expect(requests).toEqual([
      "https://boards-api.greenhouse.io/robots.txt",
      "https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=true",
    ]);
  });

  it("follows every SmartRecruiters page and stops at the total", async () => {
    const posting = (id: string) => ({
      id,
      name: `Role ${id}`,
      location: { city: "Milan", country: "it", fullLocation: "Milan, Italy" },
    });
    const pages: Record<string, unknown> = {
      "0": { offset: 0, limit: 1, totalFound: 2, content: [posting("1")] },
      "1": { offset: 1, limit: 1, totalFound: 2, content: [posting("2")] },
    };
    const { client, requests } = scripted((url) => {
      const offset = url.searchParams.get("offset") ?? "0";
      const body = pages[offset];
      return body ? { body: JSON.stringify(body) } : undefined;
    });
    const result = await ATS_ADAPTERS.smartrecruiters.fetchJobs(
      { ats: "smartrecruiters", slug: "acme" },
      client,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jobs.map((job) => job.sourceJobId)).toEqual(["1", "2"]);
    expect(requests.filter((url) => url.includes("/postings"))).toHaveLength(2);
  });

  it("returns a failure and no jobs when a later page fails", async () => {
    const pages: Record<string, { status?: number; body: string }> = {
      "0": {
        body: JSON.stringify({
          offset: 0,
          limit: 1,
          totalFound: 2,
          content: [{ id: "1", name: "Role", location: { country: "it" } }],
        }),
      },
      "1": { status: 503, body: "down" },
    };
    const { client } = scripted((url) => pages[url.searchParams.get("offset") ?? "0"]);
    const result = await ATS_ADAPTERS.smartrecruiters.fetchJobs(
      { ats: "smartrecruiters", slug: "acme" },
      client,
    );
    expect(result).toMatchObject({ ok: false, code: "http-status", status: 503 });
  });

  it("reports a 404 board as a board that no longer exists, not as an empty board", async () => {
    const { client } = scripted(() => ({ status: 404, body: "Not Found" }));
    const result = await ATS_ADAPTERS.workable.fetchJobs({ ats: "workable", slug: "gone" }, client);
    expect(result).toMatchObject({ ok: false, code: "board-not-found", status: 404 });
  });

  it("reads a board answer larger than a web page may be, as big companies' boards are", async () => {
    const board = JSON.parse(greenhouseBody) as { jobs: { content?: string }[] };
    // About 8 MB of descriptions: over the client's 5 MB page limit.
    board.jobs[0]!.content = "x".repeat(8 * 1024 * 1024);
    const { client } = scripted(() => ({ body: JSON.stringify(board) }));
    const result = await ATS_ADAPTERS.greenhouse.fetchJobs(
      { ats: "greenhouse", slug: "bigco" },
      client,
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a slug that could change the URL, without requesting anything", async () => {
    const { client, requests } = scripted(() => ({ body: greenhouseBody }));
    const result = await ATS_ADAPTERS.greenhouse.fetchJobs(
      { ats: "greenhouse", slug: "acme/../../other" },
      client,
    );
    expect(result).toMatchObject({ ok: false, code: "invalid-slug" });
    expect(requests).toEqual([]);
    expect(isValidSlug("acme-corp.eu")).toBe(true);
    expect(isValidSlug("-acme")).toBe(false);
  });

  it("fails rather than read past the page limit", async () => {
    const { client } = scripted((url) => ({
      body: JSON.stringify({
        offset: Number(url.searchParams.get("offset") ?? 0),
        limit: 1,
        totalFound: 10_000,
        content: [{ id: "x", name: "Role", location: { country: "it" } }],
      }),
    }));
    const result = await ATS_ADAPTERS.smartrecruiters.fetchJobs(
      { ats: "smartrecruiters", slug: "acme" },
      client,
    );
    expect(result).toMatchObject({ ok: false, code: "too-many-pages" });
  });
});
