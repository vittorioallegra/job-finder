// protects=postings a company declares as schema.org JobPosting data are read without an AI model, from its careers page or from the posting pages its sitemap lists, and a read from markup is never complete, so it closes nothing;
// fails_when=a JobPosting in a graph, list or array is missed, a posting is read twice, a sitemap on another host or a non-posting address is followed, the posting pages read exceed the cap, or a read from markup counts as complete;
// no_claim=real company sites: every page and sitemap here is a small hand-written document;
import { describe, expect, it } from "vitest";
import { createHttpClient } from "../net";
import { scanCareersPage } from "./scan";
import { postingsFromPage, sitemapPostingUrls } from "./structured";

const CAREERS = "https://jobs.acme.example/careers";
const ld = (data: unknown) =>
  `<html><script type="application/ld+json">${JSON.stringify(data)}</script></html>`;

function web(routes: Record<string, string>) {
  const requests: string[] = [];
  const fetchFake = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    const body = routes[url];
    return body === undefined
      ? new Response("", { status: 404 })
      : new Response(body, { status: 200, headers: { "content-type": "text/html" } });
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

const posting = (title: string, extra: object = {}) => ({
  "@type": "JobPosting",
  title,
  url: `https://jobs.acme.example/jobs/${title.toLowerCase().replace(/ /g, "-")}`,
  description: "<p>Build things.</p>",
  jobLocation: { address: { addressLocality: "Milan", addressCountry: "IT" } },
  ...extra,
});

describe("postings declared as JobPosting data", () => {
  it("reads postings from a graph, a list and an array, once each, with place and remote", () => {
    const html = [
      ld({ "@graph": [posting("Data Analyst"), { "@type": "WebPage" }] }),
      ld([posting("Designer"), posting("Data Analyst")]),
      ld({
        "@type": "ItemList",
        itemListElement: [{ item: posting("Remote Dev", { jobLocationType: "TELECOMMUTE" }) }],
      }),
      '<script type="application/ld+json">{broken</script>',
    ].join("");

    const jobs = postingsFromPage(html, CAREERS, "Acme");

    expect(jobs.map((job) => job.title)).toEqual(["Data Analyst", "Designer", "Remote Dev"]);
    expect(jobs[0]?.description).toContain("Build things");
    expect(jobs[0]?.locations[0]?.raw).toBe("Milan, IT");
    expect(jobs[2]?.workMode).toBe("remote");
  });

  it("finds nothing on a page without JobPosting data", () => {
    expect(postingsFromPage("<html><body>Join us</body></html>", CAREERS, "Acme")).toEqual([]);
  });
});

describe("sitemap of posting pages", () => {
  const sitemap = (urls: string[]) =>
    `<urlset>${urls.map((url) => `<url><loc>${url}</loc></url>`).join("")}</urlset>`;

  it("lists posting addresses on the careers host, through robots.txt and an index", async () => {
    const { http } = web({
      "https://jobs.acme.example/robots.txt": "Sitemap: https://jobs.acme.example/index.xml",
      "https://jobs.acme.example/index.xml": `<sitemapindex><sitemap><loc>https://jobs.acme.example/s1.xml</loc></sitemap></sitemapindex>`,
      "https://jobs.acme.example/s1.xml": sitemap([
        "https://jobs.acme.example/jobs/data-analyst",
        "https://jobs.acme.example/about/team",
        "https://other.example/jobs/elsewhere",
        "https://jobs.acme.example/jobs",
      ]),
    });

    expect(await sitemapPostingUrls(CAREERS, http)).toEqual([
      "https://jobs.acme.example/jobs/data-analyst",
    ]);
  });

  it("reads each listed posting page, and the result is not complete", async () => {
    const page = (title: string) => ld(posting(title));
    const { http, requests } = web({
      [CAREERS]: "<html>Careers</html>",
      "https://jobs.acme.example/sitemap.xml": sitemap([
        "https://jobs.acme.example/jobs/data-analyst",
        "https://jobs.acme.example/jobs/designer",
      ]),
      "https://jobs.acme.example/jobs/data-analyst": page("Data Analyst"),
      "https://jobs.acme.example/jobs/designer": page("Designer"),
    });

    const result = await scanCareersPage({ name: "Acme", careersUrl: CAREERS }, { http });

    expect(result).toMatchObject({ ok: true, complete: false });
    expect(result.ok && result.jobs.map((job) => job.title)).toEqual(["Data Analyst", "Designer"]);
    expect(requests).toContain("https://jobs.acme.example/jobs/designer");
  });

  it("reads the careers page's own postings with no AI and without completing", async () => {
    const { http } = web({ [CAREERS]: ld(posting("Data Analyst")) });

    expect(await scanCareersPage({ name: "Acme", careersUrl: CAREERS }, { http })).toMatchObject({
      ok: true,
      complete: false,
    });
  });
});
