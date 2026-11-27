// protects=a company's site is read for its careers page (an embedded or linked ATS board becomes a board to scan, a careers page with no board stays a page, a fallback path counts only when it reads like careers, a site with none gives nothing), and the companies of a country come from DBpedia once per country, without job-list sites, with names cleaned, skipping followed and already read sites, a few sites at a time;
// fails_when=an account or job-alert page is chosen over the job search, a careers subdomain of the same company is not followed, a "join us" page is missed, a link to an ATS board is missed, an unrelated page is taken as careers, a company already followed is looked up again, a job site is returned as a company, a failing registry reads as an answer, or the same site is read twice in a session;
// no_claim=how much of a country DBpedia covers and the live sites, which only a live check shows; every page here is a small hand-written document;
import { describe, expect, it } from "vitest";
import { createHttpClient } from "../net";
import { careersLinks, findCareersPage } from "./careers-page";
import {
  dbpediaCountry,
  discoverFromRegistry,
  registryCountries,
  registryEntries,
  registryQuery,
} from "./registry";

type Route = (url: URL) => Response | undefined;

function clientWith(route: Route) {
  const requests: string[] = [];
  const fetchFake = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/robots.txt") return new Response("", { status: 404 });
    requests.push(url.toString());
    return route(url) ?? new Response("not found", { status: 404 });
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

const html = (body: string) => new Response(`<html><body>${body}</body></html>`, { status: 200 });

describe("careers links", () => {
  it("ranks the company's own careers link and an ATS link above the rest, in several languages", () => {
    const links = careersLinks(
      `<a href="/chi-siamo">Chi siamo</a>
       <a href="/lavora-con-noi">Lavora con noi</a>
       <a href="https://jobs.lever.co/acme">Jobs</a>
       <a href="https://other.example/blog/careers-advice">Careers advice</a>
       <a href="mailto:jobs@example.com">Jobs</a>`,
      "https://www.example.it",
    );
    expect(links[0]).toBe("https://jobs.lever.co/acme");
    expect(links).toContain("https://www.example.it/lavora-con-noi");
    expect(links).not.toContain("https://www.example.it/chi-siamo");
    expect(links.some((link) => link.startsWith("mailto"))).toBe(false);
  });
});

describe("finding a careers page", () => {
  it("takes a board embedded in the home page, a board the careers page links, and otherwise the page itself", async () => {
    const { http } = clientWith((url) => {
      if (url.hostname === "embedded.example")
        return html('<a href="https://boards.greenhouse.io/embedded">x</a>');
      if (url.hostname === "linked.example" && url.pathname === "/")
        return html('<a href="/careers">Careers</a>');
      if (url.hostname === "linked.example" && url.pathname === "/careers")
        return html('<a href="https://apply.workable.com/linked">Apply</a>');
      if (url.hostname === "plain.example" && url.pathname === "/")
        return html('<a href="/lavora-con-noi">Lavora con noi</a>');
      if (url.hostname === "plain.example") return html("Posizioni aperte: nessuna al momento.");
      return undefined;
    });

    expect(await findCareersPage("Embedded", "https://embedded.example", { http })).toEqual({
      ats: "greenhouse",
      slug: "embedded",
      careersUrl: "https://boards.greenhouse.io/embedded",
      name: "Embedded",
    });
    expect(await findCareersPage("Linked", "linked.example", { http })).toMatchObject({
      ats: "workable",
      slug: "linked",
    });
    expect(await findCareersPage("Plain", "https://plain.example", { http })).toEqual({
      ats: null,
      slug: null,
      careersUrl: "https://plain.example/lavora-con-noi",
      name: "Plain",
    });
  });

  it("tries a fallback path only when the home page links none, and counts it only if it reads like careers", async () => {
    const reads = clientWith((url) => {
      if (url.pathname === "/") return html("Welcome");
      if (url.pathname === "/careers") return html("Careers: join our team, see open positions");
      return undefined;
    });
    expect(
      await findCareersPage("Fallback", "https://fallback.example", { http: reads.http }),
    ).toMatchObject({
      ats: null,
      careersUrl: "https://fallback.example/careers",
    });

    const unrelated = clientWith((url) =>
      url.pathname === "/" || url.pathname === "/careers" || url.pathname === "/jobs"
        ? html("A shop for garden tools")
        : undefined,
    );
    expect(
      await findCareersPage("Shop", "https://shop.example", { http: unrelated.http }),
    ).toBeUndefined();
    expect(
      await findCareersPage("Down", "https://down.example", { http: unrelated.http }),
    ).toBeUndefined();
  });
});

const bindings = (rows: Array<[string, string]>) =>
  new Response(
    JSON.stringify({
      results: {
        bindings: rows.map(([name, site]) => ({ name: { value: name }, site: { value: site } })),
      },
    }),
    { status: 200 },
  );

describe("registry of companies by country", () => {
  it("names a country the way DBpedia does, and builds one query per country", () => {
    expect(dbpediaCountry("IT")).toBe("Italy");
    expect(dbpediaCountry("US")).toBe("United_States");
    expect(registryQuery("Italy")).toContain("dbo:locationCountry dbr:Italy");
    expect(
      registryCountries({ keywords: [], locations: ["Italia", "Italy", "Milan", "EU"] }),
    ).toEqual(["IT"]);
  });

  it("lists one entry per site, cleaned, without job sites and archive copies", async () => {
    const { http } = clientWith((url) =>
      url.hostname === "dbpedia.org"
        ? bindings([
            ["Moncler", "https://www.moncler.com/"],
            ["Moncler (company)", "https://moncler.com/it"],
            ["Jobs Aggregator", "https://www.indeed.com/"],
            ["Old Site", "https://web.archive.org/web/2012/http://old.example/"],
            ["", "https://empty.example"],
          ])
        : undefined,
    );

    expect(await registryEntries("IT", { http })).toEqual([
      { name: "Moncler", website: "https://www.moncler.com/" },
    ]);
  });

  it("returns the careers pages of a country's companies, skips followed and already read sites, and fails to nothing when the registry is down", async () => {
    const { http, requests } = clientWith((url) => {
      if (url.hostname === "dbpedia.org")
        return bindings([
          ["Alpha SpA", "https://alpha.example"],
          ["Beta Srl", "https://beta.example"],
          ["Gamma", "https://gamma.example"],
        ]);
      if (url.hostname === "alpha.example") return html('<a href="/careers">Careers</a>');
      if (url.hostname === "beta.example") return html("nothing");
      return undefined;
    });

    const first = await discoverFromRegistry(
      { keywords: [], locations: ["Italia"], known: ["gamma.example"] },
      { http },
    );

    expect(first.answered).toBe(1);
    expect(first.candidates.map((candidate) => candidate.name)).toEqual(["Alpha SpA"]);
    // The followed company is never read.
    expect(requests.some((line) => line.includes("gamma.example"))).toBe(false);

    // A second run in the same session does not read the same sites again.
    const before = requests.length;
    const second = await discoverFromRegistry({ keywords: [], locations: ["Italia"] }, { http });
    expect(second.candidates.map((candidate) => candidate.name)).toEqual(
      ["Gamma"].filter(() => false),
    );
    expect(requests.slice(before).some((line) => line.includes("alpha.example"))).toBe(false);

    const down = clientWith(() => undefined);
    expect(
      await discoverFromRegistry({ keywords: [], locations: ["Germania"] }, { http: down.http }),
    ).toEqual({
      candidates: [],
      answered: 0,
    });
  });
});

describe("choosing among careers links", () => {
  it("prefers the job search to an account page, follows a careers subdomain of the same company, and reads join-us", async () => {
    const { http } = clientWith((url) => {
      if (url.hostname === "staffing.example" && url.pathname === "/")
        return html(
          '<a href="/it/my-account/job-alerts">My Job Alerts</a><a href="/it/consigli">Consigli di carriera</a><a href="/it/ricerca-offerte">Offerte di lavoro</a>',
        );
      if (url.hostname === "staffing.example") return html("<p>Offerte</p>");
      if (url.hostname === "www.consulting.example" && url.pathname === "/")
        return html('<a href="/carriere">Carriere</a>');
      if (url.hostname === "www.consulting.example")
        return html(
          '<a href="https://careers.consulting.example/">Candidati</a><a href="/carriere/x">Careers</a>',
        );
      if (url.hostname === "studio.example" && url.pathname === "/")
        return html('<a href="/join-us">join us</a>');
      if (url.hostname === "studio.example") return html("<p>We are hiring</p>");
      return undefined;
    });
    const options = { http };
    expect(
      (await findCareersPage("Staffing", "https://staffing.example", options))?.careersUrl,
    ).toBe("https://staffing.example/it/ricerca-offerte");
    expect(
      (await findCareersPage("Consulting", "https://www.consulting.example", options))?.careersUrl,
    ).toBe("https://careers.consulting.example/");
    expect((await findCareersPage("Studio", "https://studio.example", options))?.careersUrl).toBe(
      "https://studio.example/join-us",
    );
  });
});
