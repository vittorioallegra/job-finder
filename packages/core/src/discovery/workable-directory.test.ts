// protects=the Workable directory is asked per country and role, in English country names, two pages at most; the companies it lists become Workable board candidates named after the company, only when their account name matches; a repeated company is asked once, and a directory that cannot be read gives nothing;
// fails_when=a country is searched in the user's language or twice, a company whose account is another company's is added, a board that does not exist is added, the name is the board token, more pages than planned are read, or a failing directory reads as success;
// no_claim=the live directory and the real coverage of Italian companies, which only a live check shows; the answers here are small hand-written documents;
import { describe, expect, it } from "vitest";
import { createHttpClient } from "../net";
import { directoryPlaces, discoverWorkableDirectory, slugVariants } from "./workable-directory";

interface Posting {
  id: string;
  title: string;
  website?: string;
}

function directory(postings: Posting[], next?: string) {
  return JSON.stringify({
    jobs: postings.map((company) => ({ company })),
    nextPageToken: next ?? null,
  });
}

function clientFor(options: {
  pages: Record<string, string>;
  accounts: Record<string, string | undefined>;
}) {
  const requests: string[] = [];
  const fetchFake = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/robots.txt") return new Response("", { status: 404 });
    requests.push(url.toString());
    if (url.hostname === "jobs.workable.com") {
      const key = `${url.searchParams.get("location")}|${url.searchParams.get("query") ?? ""}|${url.searchParams.get("pageToken") ?? ""}`;
      const body = options.pages[key];
      return body === undefined
        ? new Response("{}", { status: 500 })
        : new Response(body, { status: 200 });
    }
    const slug = url.pathname.split("/").at(-1) ?? "";
    const name = options.accounts[slug];
    return name === undefined
      ? new Response("{}", { status: 404 })
      : new Response(JSON.stringify({ name, jobs: [] }), { status: 200 });
  }) as typeof fetch;
  const http = createHttpClient({
    fetch: fetchFake,
    intervalMs: 0,
    sleep: async () => {},
    maxAttempts: 1,
  });
  return { http, requests };
}

describe("Workable directory", () => {
  it("names each country once, in English, and keeps cities as typed only when no country is given", () => {
    expect(directoryPlaces(["Italia", "Italy", "Milan"])).toEqual(["Italy"]);
    expect(directoryPlaces(["Germania", "Francia"])).toEqual(["Germany", "France"]);
    expect(directoryPlaces(["Torino", "Milan"])).toEqual(["Torino", "Milan"]);
    // An area is not one country: the directory is not asked for it.
    expect(directoryPlaces(["EU"])).toEqual([]);
  });

  it("guesses the board name from the company's name and website", () => {
    expect(slugVariants("Webranking S.r.l.", null)).toEqual(
      ["webranking-s-r-l", "webranking", "webranking"].slice(0, 2),
    );
    expect(slugVariants("Trustfull", "https://www.trustfull.com/")).toEqual(["trustfull"]);
    expect(slugVariants("Café Ünique GmbH", "unique.io")).toContain("unique");
  });

  it("finds the companies hiring in the country, reads two pages, and returns their boards by company name", async () => {
    const { http, requests } = clientFor({
      pages: {
        "Italy|Frontend|": directory(
          [
            { id: "c1", title: "Webranking" },
            { id: "c1", title: "Webranking" },
            { id: "c2", title: "Trustfull", website: "https://trustfull.com" },
          ],
          "p2",
        ),
        "Italy|Frontend|p2": directory(
          [
            { id: "c3", title: "MotorK" },
            { id: "c4", title: "Ghost" },
          ],
          "p3",
        ),
      },
      accounts: {
        webranking: "Webranking",
        motork: "MotorK",
        // Trustfull's own account is not called after it: another company holds that name.
        trustfull: "Trust Wallet",
      },
    });

    const result = await discoverWorkableDirectory(
      { keywords: ["Frontend"], locations: ["Italia", "Italy", "Milan"] },
      { http },
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.candidates).toEqual([
      {
        ats: "workable",
        slug: "webranking",
        careersUrl: "https://apply.workable.com/webranking",
        name: "Webranking",
      },
      {
        ats: "workable",
        slug: "motork",
        careersUrl: "https://apply.workable.com/motork",
        name: "MotorK",
      },
    ]);
    // Two directory pages (the third token is not followed), once per country.
    expect(requests.filter((url) => url.includes("jobs.workable.com"))).toHaveLength(2);
  });

  it("gives nothing for no place, and fails when the directory cannot be read", async () => {
    const { http } = clientFor({ pages: {}, accounts: {} });
    expect(
      await discoverWorkableDirectory({ keywords: ["x"], locations: [] }, { http }),
    ).toMatchObject({
      ok: true,
      candidates: [],
      answered: 0,
    });
    expect(
      await discoverWorkableDirectory({ keywords: ["x"], locations: ["Italia"] }, { http }),
    ).toEqual({ ok: false, code: "failed" });
  });
});
