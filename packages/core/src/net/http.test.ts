// protects=the HTTP client sends POST bodies and extra headers without caching them, sends the generic user agent, honours robots.txt (cached per origin, failures blocking), spaces requests per host, retries 429 and 5xx with backoff and Retry-After, caches 2xx responses for the TTL, rewrites origins to the fixture base URL, and never fetches non-http URLs or cancelled requests;
// fails_when=a page is fetched despite a robots disallow, robots.txt is read once per request, a host gets two requests within the interval, a 404 is retried, a body over the limit is returned, or a fixture-rewritten request reaches the real host;
// no_claim=real network behaviour of job sites, DNS and TLS, and the rate of the production 1 req/s default under real timers are not exercised; the fixture server test covers the real fetch path on loopback only.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpClient, JOB_FINDER_USER_AGENT } from "./http";

interface Call {
  url: string;
  userAgent: string | undefined;
  at: number;
}

type Route = (url: URL) => Response | Promise<Response>;

/** A scripted fetch that records every call. Responses are built by `route`. */
function scriptedFetch(route: Route): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFake = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({
      url,
      userAgent: new Headers(init?.headers).get("user-agent") ?? undefined,
      at: Date.now(),
    });
    return route(new URL(url));
  };
  return { fetch: fetchFake as typeof fetch, calls };
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function robotsTxt(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/plain" } });
}

/** A route that serves robots.txt with `robots` and every other path with `page`. */
function site(robots: string | number, page: (url: URL) => Response): Route {
  return (url) => {
    if (url.pathname === "/robots.txt") {
      return typeof robots === "string" ? robotsTxt(robots) : new Response("", { status: robots });
    }
    return page(url);
  };
}

const notFoundRobots = 404;
const sleeps: number[] = [];
const recordSleep = async (ms: number): Promise<void> => {
  sleeps.push(ms);
};

afterEach(() => {
  sleeps.length = 0;
});

describe("http client POST and request headers", () => {
  it("sends the body and the extra headers, and never caches a POST", async () => {
    const seen: { method?: string; body?: string; header?: string | null }[] = [];
    const fetchFake = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).pathname === "/robots.txt") return new Response("", { status: 404 });
      seen.push({
        method: init?.method,
        body: typeof init?.body === "string" ? init.body : undefined,
        header: new Headers(init?.headers).get("x-test-key"),
      });
      return new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const client = createHttpClient({ fetch: fetchFake, intervalMs: 0, sleep: async () => {} });
    const url = "https://search.example.test/api";

    const first = await client.post(url, { body: '{"q":"x"}', headers: { "x-test-key": "k1" } });
    const second = await client.post(url, { body: '{"q":"x"}', headers: { "x-test-key": "k1" } });

    expect(first.ok && second.ok).toBe(true);
    expect(seen).toEqual([
      { method: "POST", body: '{"q":"x"}', header: "k1" },
      { method: "POST", body: '{"q":"x"}', header: "k1" },
    ]);
  });

  it("sends a GET with headers without serving it from the cache", async () => {
    let calls = 0;
    const fetchFake = (async (input: RequestInfo | URL) => {
      if (new URL(String(input)).pathname === "/robots.txt") return new Response("", { status: 404 });
      calls += 1;
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const client = createHttpClient({ fetch: fetchFake, intervalMs: 0, sleep: async () => {} });
    const url = "https://search.example.test/keyed";

    await client.get(url, { headers: { "x-test-key": "k1" } });
    await client.get(url, { headers: { "x-test-key": "k1" } });

    expect(calls).toBe(2);
  });
});

describe("http client", () => {
  it("sends the generic user agent and returns the body of a 2xx page", async () => {
    const { fetch, calls } = scriptedFetch(site(notFoundRobots, () => html("<p>jobs</p>")));
    const client = createHttpClient({ fetch, intervalMs: 1, sleep: recordSleep });

    const result = await client.get("https://jobs.example.test/careers");

    expect(result).toMatchObject({
      ok: true,
      status: 200,
      body: "<p>jobs</p>",
      cached: false,
      url: "https://jobs.example.test/careers",
    });
    const pageCall = calls.find((call) => call.url.endsWith("/careers"));
    expect(pageCall?.userAgent).toBe(JOB_FINDER_USER_AGENT);
  });

  it("does not request a disallowed path and still serves an allowed one", async () => {
    const robots = "User-agent: *\nDisallow: /private\n";
    const { fetch, calls } = scriptedFetch(site(robots, () => html("ok")));
    const client = createHttpClient({ fetch, intervalMs: 1, sleep: recordSleep });

    const blocked = await client.get("https://jobs.example.test/private/roles");
    const allowed = await client.get("https://jobs.example.test/public/roles");

    expect(blocked).toEqual({
      ok: false,
      code: "blocked-by-robots",
      url: "https://jobs.example.test/private/roles",
    });
    expect(allowed.ok).toBe(true);
    expect(calls.some((call) => call.url.includes("/private"))).toBe(false);
  });

  it("reads robots.txt once per origin", async () => {
    const { fetch, calls } = scriptedFetch(site(notFoundRobots, () => html("ok")));
    const client = createHttpClient({ fetch, intervalMs: 1, sleep: recordSleep });

    await client.get("https://jobs.example.test/a");
    await client.get("https://jobs.example.test/b");

    expect(calls.filter((call) => call.url.endsWith("/robots.txt"))).toHaveLength(1);
  });

  it("blocks an origin whose robots.txt answers 401 or 403", async () => {
    const { fetch, calls } = scriptedFetch(site(403, () => html("ok")));
    const client = createHttpClient({ fetch, intervalMs: 1, sleep: recordSleep });

    const result = await client.get("https://locked.example.test/a");

    expect(result).toMatchObject({ ok: false, code: "blocked-by-robots" });
    expect(calls.filter((call) => !call.url.endsWith("/robots.txt"))).toHaveLength(0);
  });

  it("retries 503 and 429 with backoff, honouring Retry-After in seconds", async () => {
    let page = 0;
    const { fetch } = scriptedFetch(
      site(notFoundRobots, () => {
        page += 1;
        if (page === 1) {
          return new Response("", { status: 503 });
        }
        if (page === 2) {
          return new Response("", { status: 429, headers: { "retry-after": "3" } });
        }
        return html("finally");
      }),
    );
    const client = createHttpClient({ fetch, intervalMs: 1, sleep: recordSleep });

    const result = await client.get("https://jobs.example.test/retry");

    expect(result).toMatchObject({ ok: true, body: "finally" });
    expect(sleeps).toEqual([1_000, 3_000]);
  });

  it("gives up after the attempt limit and reports the last status", async () => {
    const { fetch } = scriptedFetch(site(notFoundRobots, () => new Response("", { status: 503 })));
    const client = createHttpClient({ fetch, intervalMs: 1, sleep: recordSleep, maxAttempts: 3 });

    const result = await client.get("https://jobs.example.test/down");

    expect(result).toEqual({
      ok: false,
      code: "http-status",
      url: "https://jobs.example.test/down",
      status: 503,
    });
    expect(sleeps).toEqual([1_000, 2_000]);
  });

  it("does not retry a 404", async () => {
    const { fetch, calls } = scriptedFetch(
      site(notFoundRobots, () => new Response("", { status: 404 })),
    );
    const client = createHttpClient({ fetch, intervalMs: 1, sleep: recordSleep });

    const result = await client.get("https://jobs.example.test/missing");

    expect(result).toMatchObject({ ok: false, code: "http-status", status: 404 });
    expect(calls.filter((call) => call.url.endsWith("/missing"))).toHaveLength(1);
  });

  it("serves a repeat request from the cache within the TTL and refetches after it", async () => {
    let clock = 0;
    let pageCalls = 0;
    const { fetch } = scriptedFetch(
      site(notFoundRobots, () => {
        pageCalls += 1;
        return html(`page ${pageCalls}`);
      }),
    );
    const client = createHttpClient({
      fetch,
      intervalMs: 1,
      sleep: recordSleep,
      cacheTtlMs: 1_000,
      now: () => clock,
    });

    const first = await client.get("https://jobs.example.test/cached");
    clock = 500;
    const second = await client.get("https://jobs.example.test/cached");
    clock = 1_500;
    const third = await client.get("https://jobs.example.test/cached");

    expect(first).toMatchObject({ ok: true, cached: false, body: "page 1" });
    expect(second).toMatchObject({ ok: true, cached: true, body: "page 1" });
    expect(third).toMatchObject({ ok: true, cached: false, body: "page 2" });
    expect(pageCalls).toBe(2);
  });

  it("rewrites the origin to the fixture base URL and keeps path and query", async () => {
    const { fetch, calls } = scriptedFetch(site(notFoundRobots, () => html("fixture")));
    const client = createHttpClient({
      fetch,
      intervalMs: 1,
      sleep: recordSleep,
      fixtureBaseUrl: "http://127.0.0.1:4010/",
    });

    const result = await client.get("https://jobs.example.test/x?page=2");

    expect(result).toMatchObject({ ok: true, url: "http://127.0.0.1:4010/x?page=2" });
    expect(calls.map((call) => call.url)).toEqual([
      "http://127.0.0.1:4010/robots.txt",
      "http://127.0.0.1:4010/x?page=2",
    ]);
  });

  it("starts no two requests to one host within the interval", async () => {
    const intervalMs = 60;
    const { fetch, calls } = scriptedFetch(site(notFoundRobots, () => html("ok")));
    const client = createHttpClient({ fetch, intervalMs });

    await Promise.all([
      client.get("https://pace.example.test/a"),
      client.get("https://pace.example.test/b"),
      client.get("https://pace.example.test/c"),
    ]);

    const starts = calls.map((call) => call.at).sort((a, b) => a - b);
    expect(starts).toHaveLength(4);
    for (let index = 1; index < starts.length; index += 1) {
      expect((starts[index] ?? 0) - (starts[index - 1] ?? 0)).toBeGreaterThanOrEqual(
        intervalMs - 5,
      );
    }
  });

  it("rejects URLs that are not absolute http or https without fetching", async () => {
    const { fetch, calls } = scriptedFetch(site(notFoundRobots, () => html("ok")));
    const client = createHttpClient({ fetch, intervalMs: 1, sleep: recordSleep });

    expect(await client.get("file:///etc/hosts")).toMatchObject({ ok: false, code: "invalid-url" });
    expect(await client.get("not a url")).toMatchObject({ ok: false, code: "invalid-url" });
    expect(calls).toHaveLength(0);
  });

  it("reports a body over the size limit as too-large", async () => {
    const { fetch } = scriptedFetch(site(notFoundRobots, () => html("x".repeat(64))));
    const client = createHttpClient({
      fetch,
      intervalMs: 1,
      sleep: recordSleep,
      maxBodyBytes: 16,
    });

    const result = await client.get("https://jobs.example.test/huge");

    expect(result).toMatchObject({ ok: false, code: "too-large", status: 200 });
  });

  it("reports a network failure after every attempt", async () => {
    const fetchFake = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/robots.txt")) {
        return new Response("", { status: 404 });
      }
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const client = createHttpClient({
      fetch: fetchFake,
      intervalMs: 1,
      sleep: recordSleep,
      maxAttempts: 3,
    });

    const result = await client.get("https://jobs.example.test/offline");

    expect(result).toEqual({
      ok: false,
      code: "network",
      url: "https://jobs.example.test/offline",
    });
    expect(sleeps).toEqual([1_000, 2_000]);
  });

  it("does not fetch at all when the caller has already cancelled", async () => {
    const { fetch, calls } = scriptedFetch(site(notFoundRobots, () => html("ok")));
    const client = createHttpClient({ fetch, intervalMs: 1, sleep: recordSleep });
    const controller = new AbortController();
    controller.abort();

    const result = await client.get("https://jobs.example.test/cancelled", {
      signal: controller.signal,
    });

    expect(result).toMatchObject({ ok: false, code: "aborted" });
    expect(calls.filter((call) => call.url.endsWith("/cancelled"))).toHaveLength(0);
  });

  it("checks robots.txt for the final URL after a redirect", async () => {
    const { fetch } = scriptedFetch((url) => {
      if (url.pathname === "/robots.txt") {
        return robotsTxt("User-agent: *\nDisallow: /private\n");
      }
      const response = html("secret");
      Object.defineProperty(response, "url", { value: `https://jobs.example.test/private/x` });
      return response;
    });
    const client = createHttpClient({ fetch, intervalMs: 1, sleep: recordSleep });

    const result = await client.get("https://jobs.example.test/public/redirect");

    expect(result).toEqual({
      ok: false,
      code: "blocked-by-robots",
      url: "https://jobs.example.test/private/x",
    });
  });

  it("fetches through a real local fixture server when the fixture base URL is set", async () => {
    const server: Server = createServer((request, response) => {
      if (request.url === "/robots.txt") {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": "text/html" }).end("<h1>fixture</h1>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const { port } = server.address() as AddressInfo;
    const client = createHttpClient({
      intervalMs: 1,
      fixtureBaseUrl: `http://127.0.0.1:${port}`,
    });

    const result = await client.get("https://jobs.example.test/careers");

    expect(result).toMatchObject({ ok: true, body: "<h1>fixture</h1>" });
  });
});

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});
