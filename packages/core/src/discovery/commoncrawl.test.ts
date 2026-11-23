// protects=the Common Crawl index is read per ATS domain with a bounded, status-200 sample, the URLs of its lines become board candidates, a domain without captures is empty rather than failed, and the run fails only when every domain fails;
// fails_when=a domain is queried without its subdomains, a malformed line stops the sample, a 404 counts as a failure, one failing domain hides the others, a repeat read is fetched again inside the cache TTL, or the key-free index request carries a header;
// no_claim=the current collection id and the sample's coverage of real boards, which only a live check or a recording shows; the collection id is checked by hand when it changes.
import { describe, expect, it } from "vitest";
import { createHttpClient } from "../net";
import { commonCrawlSource, cdxUrl, COMMON_CRAWL_INDEX, parseCdxLines } from "./commoncrawl";

type Route = (domain: string) => Response;

function indexClient(route: Route) {
  const requests: string[] = [];
  const fetchFake = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname !== "index.commoncrawl.org") return new Response("", { status: 404 });
    if (url.pathname === "/robots.txt") return new Response("", { status: 404 });
    requests.push(url.toString());
    return route(url.searchParams.get("url") ?? "");
  }) as typeof fetch;
  const http = createHttpClient({
    fetch: fetchFake,
    intervalMs: 0,
    sleep: async () => {},
    maxAttempts: 1,
  });
  return { http, requests };
}

const ndjson = (...urls: string[]) => urls.map((url) => JSON.stringify({ url })).join("\n");

describe("Common Crawl index", () => {
  it("builds a domain-scoped, status-200, URL-only query for the pinned collection", () => {
    const url = new URL(cdxUrl("jobs.lever.co"));

    expect(url.origin + url.pathname).toBe(`https://index.commoncrawl.org/${COMMON_CRAWL_INDEX}`);
    expect(url.searchParams.get("url")).toBe("jobs.lever.co");
    expect(url.searchParams.get("matchType")).toBe("domain");
    expect(url.searchParams.get("fl")).toBe("url");
    expect(url.searchParams.get("filter")).toBe("status:200");
    expect(url.searchParams.get("limit")).toBe("500");
  });

  it("reads one URL per line and skips lines that are not captures", () => {
    const body = `${ndjson("https://jobs.lever.co/globex/1")}\nnot json\n{"other":1}\n\n${ndjson("https://jobs.lever.co/acme")}`;

    expect(parseCdxLines(body)).toEqual([
      "https://jobs.lever.co/globex/1",
      "https://jobs.lever.co/acme",
    ]);
  });

  it("returns the board URLs of every ATS domain and treats a domain with no captures as empty", async () => {
    const { http, requests } = indexClient((domain) => {
      if (domain === "jobs.lever.co")
        return new Response(ndjson("https://jobs.lever.co/globex/1"), { status: 200 });
      return new Response("", { status: 404 });
    });

    const result = await commonCrawlSource.urls({ http });

    expect(result).toEqual({ ok: true, urls: ["https://jobs.lever.co/globex/1"] });
    expect(requests.some((url) => url.includes("url=jobs.lever.co"))).toBe(true);
    expect(requests.some((url) => url.includes("url=boards.greenhouse.io"))).toBe(true);
  });

  it("fails only when every domain fails, and keeps the others when one fails", async () => {
    const allDown = indexClient(() => new Response("oops", { status: 500 }));
    expect(await commonCrawlSource.urls({ http: allDown.http })).toEqual({
      ok: false,
      code: "http-status",
    });

    const oneDown = indexClient((domain) =>
      domain === "jobs.lever.co"
        ? new Response("oops", { status: 500 })
        : new Response(ndjson("https://apply.workable.com/initech"), { status: 200 }),
    );
    expect(await commonCrawlSource.urls({ http: oneDown.http })).toEqual({
      ok: true,
      urls: expect.arrayContaining(["https://apply.workable.com/initech"]) as unknown as string[],
    });
  });

  it("answers a repeat read of the same domain from the response cache", async () => {
    const { http, requests } = indexClient(
      () => new Response(ndjson("https://jobs.lever.co/a"), { status: 200 }),
    );

    await commonCrawlSource.urls({ http });
    const firstCount = requests.length;
    await commonCrawlSource.urls({ http });

    expect(requests.length).toBe(firstCount);
  });
});
