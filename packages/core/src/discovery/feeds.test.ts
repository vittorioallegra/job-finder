// protects=a company name from a job feed becomes a Workable, Greenhouse, Recruitee, Teamtailor, Lever or Ashby board only when the board proves to be that company's (same name, or a job with the feed's title), a name is looked up once, and feeds take turns and are capped;
// fails_when=a board of another company with a similar name is added (Fineco and Fineco Banca Privada), a board with no proof is added, the same company is looked up twice, one feed crowds out the others, or a failing feed hides the others;
// no_claim=the live APIs and their real coverage, which only a live check shows; every answer here is a small hand-written document;
import { describe, expect, it } from "vitest";
import { createHttpClient } from "../net";
import { normalizeCompanyName, sameCompany } from "./company-name";
import { discoverFromFeeds, himalayasFeed, MAX_FEED_COMPANIES, type JobFeed } from "./feeds";
import { resolveBoard } from "./resolve-board";

type Route = (url: URL, init?: RequestInit) => Response | undefined;

function clientWith(route: Route) {
  const requests: string[] = [];
  const fetchFake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/robots.txt") return new Response("", { status: 404 });
    requests.push(`${init?.method ?? "GET"} ${url.toString()}`);
    return route(url, init) ?? new Response("{}", { status: 404 });
  }) as typeof fetch;
  return {
    http: createHttpClient({
      fetch: fetchFake,
      intervalMs: 0,
      sleep: async () => {},
      maxAttempts: 1,
    }),
    requests,
  };
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("company names", () => {
  it("reduces a name to what identifies it, so legal forms do not matter and brands do", () => {
    expect(normalizeCompanyName("ALLNET.ITALIA S.p.A.")).toBe("allnet");
    expect(sameCompany("Allnet", "ALLNET.ITALIA S.p.A.")).toBe(true);
    expect(sameCompany("Fineco", "Fineco Banca Privada Kutxabank")).toBe(false);
    expect(sameCompany("", "")).toBe(false);
  });
});

describe("resolving a company to its board", () => {
  it("accepts a board whose own name is the company's, and refuses another company's", async () => {
    const { http } = clientWith((url) => {
      if (url.hostname === "boards-api.greenhouse.io" && url.pathname.endsWith("/acme-resolve")) {
        return ok({ name: "Acme Resolve" });
      }
      if (url.hostname === "api.lever.co") return ok([]);
      return undefined;
    });

    expect(await resolveBoard({ name: "Acme Resolve" }, { http })).toEqual({
      ats: "greenhouse",
      slug: "acme-resolve",
      careersUrl: "https://boards.greenhouse.io/acme-resolve",
      name: "Acme Resolve",
    });

    const other = clientWith((url) =>
      url.hostname === "boards-api.greenhouse.io"
        ? ok({ name: "Fineco Banca Privada" })
        : undefined,
    );
    expect(await resolveBoard({ name: "Finecoo" }, { http: other.http })).toBeNull();
    const clash = clientWith((url) =>
      url.hostname === "boards-api.greenhouse.io"
        ? ok({ name: "Fineco Banca Privada" })
        : undefined,
    );
    expect(await resolveBoard({ name: "Fineco Kutxa" }, { http: clash.http })).toBeNull();
  });

  it("accepts a board that carries no company name only with a job of the title the feed gave", async () => {
    const lever = (url: URL) =>
      url.hostname === "api.lever.co" ? ok([{ text: "Senior Frontend Engineer" }]) : undefined;

    const withTitle = clientWith(lever);
    expect(
      await resolveBoard(
        { name: "Lever Proof", title: "Senior Frontend Engineer" },
        { http: withTitle.http },
      ),
    ).toMatchObject({ ats: "lever", slug: "lever-proof" });

    const wrongTitle = clientWith(lever);
    expect(
      await resolveBoard(
        { name: "Lever Stranger", title: "Chief Pastry Officer" },
        { http: wrongTitle.http },
      ),
    ).toBeNull();
    const noTitle = clientWith(lever);
    expect(await resolveBoard({ name: "Lever Untitled" }, { http: noTitle.http })).toBeNull();
  });

  it("looks a name up once, found or not", async () => {
    const { http, requests } = clientWith(() => undefined);
    await resolveBoard({ name: "Nowhere Once Inc" }, { http });
    const first = requests.length;
    await resolveBoard({ name: "Nowhere Once" }, { http });
    expect(requests).toHaveLength(first);
  });
});

function feed(id: string, names: string[]): JobFeed {
  return { id, entries: async () => ({ ok: true, entries: names.map((name) => ({ name })) }) };
}

describe("discovering from feeds", () => {
  it("lists each company once, lets the feeds take turns, stops at the cap, and counts the feeds that answered", async () => {
    const many = Array.from({ length: 60 }, (_, index) => `Alpha Company ${index}`);
    const { http, requests } = clientWith(() => undefined);

    const result = await discoverFromFeeds(
      { keywords: ["x"], locations: [] },
      [
        feed("a", many),
        feed("b", ["Beta Only", "alpha company 0"]),
        { id: "broken", entries: async () => ({ ok: false }) },
      ],
      { http },
    );

    expect(result.answered).toBe(2);
    // The second feed's own company is looked up although the first feed is long.
    expect(requests.some((line) => line.includes("beta-only"))).toBe(true);
    // The repeated name is looked up once; the cap bounds the number of companies.
    const lookedUp = new Set(
      requests.map((line) => /boards\/([a-z0-9-]+)$/.exec(line)?.[1]).filter(Boolean),
    );
    expect(lookedUp.size).toBeLessThanOrEqual(MAX_FEED_COMPANIES * 2);
    expect(
      requests.filter((line) => line.includes("greenhouse.io/v1/boards/alpha-company-0")),
    ).toHaveLength(1);
  });

  it("reads Himalayas by keyword and country", async () => {
    const { http, requests } = clientWith((url) =>
      url.hostname === "himalayas.app"
        ? ok({ jobs: [{ companyName: "Remote Co", title: "Dev" }] })
        : undefined,
    );
    const criteria = { keywords: ["Frontend"], locations: ["Italia"] };

    expect(await himalayasFeed.entries(criteria, { http })).toEqual({
      ok: true,
      entries: [{ name: "Remote Co", title: "Dev" }],
    });
    expect(requests.find((line) => line.includes("himalayas"))).toContain("country=Italy");
  });
});
