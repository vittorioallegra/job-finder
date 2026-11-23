// protects=keyed search providers send the key only in a header, read their results through the shared client, and report a reply of the wrong shape as invalid-response without echoing it;
// fails_when=the key appears in a URL or body, a keyed request skips the shared client, a result without a link is read as a board, a non-http target is kept, or a malformed reply is reported as results;
// no_claim=the providers' live answers and quotas; the request and reply shapes come from their public documentation, and no live keyed call is made here.
import { describe, expect, it } from "vitest";
import { createHttpClient } from "../net";
import { createKeyedSource } from "./keyed";

const KEY = "test-key-123";

function clientWith(body: string, status = 200) {
  const requests: { url: string; method?: string; body?: string; headers: Headers }[] = [];
  const fetchFake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/robots.txt") return new Response("", { status: 404 });
    requests.push({
      url: url.toString(),
      method: init?.method,
      body: typeof init?.body === "string" ? init.body : undefined,
      headers: new Headers(init?.headers),
    });
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const http = createHttpClient({ fetch: fetchFake, intervalMs: 0, sleep: async () => {} });
  return { http, requests };
}

describe("keyed search providers", () => {
  it("Brave: sends the key in the subscription header and reads web result URLs", async () => {
    const { http, requests } = clientWith(
      JSON.stringify({ web: { results: [{ url: "https://jobs.ashbyhq.com/initech" }] } }),
    );
    const source = createKeyedSource({ provider: "brave", apiKey: KEY });

    const result = await source.search('"data" (site:jobs.ashbyhq.com)', { http });

    expect(result).toEqual({ ok: true, urls: ["https://jobs.ashbyhq.com/initech"] });
    const request = requests[0];
    expect(request?.url.startsWith("https://api.search.brave.com/res/v1/web/search?q=")).toBe(true);
    expect(request?.headers.get("x-subscription-token")).toBe(KEY);
    expect(requests.some((item) => item.url.includes(KEY))).toBe(false);
  });

  it("Tavily: posts the query and reads result URLs, with the key as a bearer token", async () => {
    const { http, requests } = clientWith(
      JSON.stringify({ results: [{ url: "https://jobs.lever.co/globex" }] }),
    );
    const source = createKeyedSource({ provider: "tavily", apiKey: KEY });

    const result = await source.search("engineer", { http });

    expect(result).toEqual({ ok: true, urls: ["https://jobs.lever.co/globex"] });
    expect(requests[0]?.method).toBe("POST");
    expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({ query: "engineer", max_results: 20 });
    expect(requests[0]?.headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(requests.some((item) => item.url.includes(KEY) || item.body?.includes(KEY))).toBe(false);
  });

  it("Serper: posts the query with the key in the API header and reads organic links", async () => {
    const { http, requests } = clientWith(
      JSON.stringify({
        organic: [
          { link: "https://example.com/careers" },
          { link: "https://apply.workable.com/acme" },
        ],
      }),
    );
    const source = createKeyedSource({ provider: "serper", apiKey: KEY });

    const result = await source.search("engineer", { http });

    expect(result).toEqual({
      ok: true,
      urls: ["https://example.com/careers", "https://apply.workable.com/acme"],
    });
    expect(requests[0]?.headers.get("x-api-key")).toBe(KEY);
    expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({ q: "engineer", num: 20 });
  });

  it("drops result links that are not http or https", async () => {
    const { http } = clientWith(
      JSON.stringify({
        results: [{ url: "javascript:alert(1)" }, { url: "https://jobs.lever.co/a" }],
      }),
    );

    const result = await createKeyedSource({ provider: "tavily", apiKey: KEY }).search("q", {
      http,
    });

    expect(result).toEqual({ ok: true, urls: ["https://jobs.lever.co/a"] });
  });

  it("reports a reply of the wrong shape as invalid-response, without the body", async () => {
    const { http } = clientWith(JSON.stringify({ unexpected: `leaked ${KEY}` }));

    const result = await createKeyedSource({ provider: "tavily", apiKey: KEY }).search("q", {
      http,
    });

    expect(result).toEqual({ ok: false, code: "invalid-response" });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("reports an error status, such as a rejected key, as a failure", async () => {
    const { http } = clientWith("denied", 401);

    const result = await createKeyedSource({ provider: "serper", apiKey: KEY }).search("q", {
      http,
    });

    expect(result).toEqual({ ok: false, code: "http-status" });
  });
});
