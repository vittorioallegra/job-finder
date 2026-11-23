// protects=DuckDuckGo result links are read to their target URLs, and its bot challenge page is reported as blocked rather than as an empty result;
// fails_when=a redirect link is returned as is, a non-http target is kept, the challenge page is parsed as no results, or an error status is reported as success;
// no_claim=the current markup of the live results page, which only a manual recording confirms; the results fixture is hand-written.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createHttpClient } from "../net";
import { duckDuckGoSource, isChallengePage, parseResults, resultTarget } from "./duckduckgo";

const results = readFileSync(
  new URL("./fixtures/duckduckgo-results.html", import.meta.url),
  "utf8",
);
const challenge = readFileSync(
  new URL("./fixtures/duckduckgo-challenge.html", import.meta.url),
  "utf8",
);

function clientWith(body: string, status = 200) {
  const requests: string[] = [];
  const fetchFake = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requests.push(url.toString());
    if (url.pathname === "/robots.txt") return new Response("", { status: 404 });
    return new Response(body, { status, headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  const http = createHttpClient({ fetch: fetchFake, intervalMs: 0, sleep: async () => {} });
  return { http, requests };
}

describe("DuckDuckGo result parsing", () => {
  it("reads redirect links to their targets and keeps direct links", () => {
    expect(parseResults(results)).toEqual([
      "https://boards.greenhouse.io/acme/jobs/4001",
      "https://boards.greenhouse.io/acme/jobs/4002",
      "https://jobs.lever.co/globex/3f2c9a",
      "https://example.com/careers",
    ]);
  });

  it("rejects targets that are not http or https", () => {
    expect(resultTarget("javascript:alert(1)")).toBeUndefined();
    expect(resultTarget("//duckduckgo.com/l/?uddg=ftp%3A%2F%2Fx.example")).toBeUndefined();
  });

  it("recognises the bot challenge page and does not read it as results", () => {
    expect(isChallengePage(challenge)).toBe(true);
    expect(isChallengePage(results)).toBe(false);
    expect(parseResults(challenge)).toEqual([]);
  });
});

describe("DuckDuckGo search source", () => {
  it("returns the result URLs of a results page", async () => {
    const { http, requests } = clientWith(results);

    const result = await duckDuckGoSource.search(`"data" (site:jobs.lever.co)`, { http });

    expect(result.ok).toBe(true);
    const search = requests.find((url) => url.startsWith("https://html.duckduckgo.com/html/?q="));
    expect(search).toBe(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`"data" (site:jobs.lever.co)`)}`,
    );
  });

  it("reports a challenge page as blocked", async () => {
    const { http } = clientWith(challenge);

    expect(await duckDuckGoSource.search("q", { http })).toEqual({ ok: false, code: "blocked" });
  });

  it("reports an error status as a failure", async () => {
    const { http } = clientWith("nope", 503);

    const result = await duckDuckGoSource.search("q", { http });

    expect(result.ok).toBe(false);
  });
});
