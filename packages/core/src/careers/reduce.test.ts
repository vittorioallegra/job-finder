// protects=a careers page reduces to its visible text and to its absolute http(s) links, each once, with fragments removed and non-web links dropped;
// fails_when=script or style text reaches the model, a relative link resolves against the wrong address, a mailto or javascript link is kept, a link repeats, or the link list grows past its cap;
// no_claim=the layouts of real careers pages; the fixtures are hand-written, so only the shapes they contain are checked.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_LINKS, reduceCareersPage } from "./reduce";

const PAGE = "https://careers.acme.example.test/careers";

describe("reduceCareersPage", () => {
  it("keeps the visible text and drops scripts and styles", () => {
    const html = readFileSync(new URL("./fixtures/static-listing.html", import.meta.url), "utf8");
    const { text } = reduceCareersPage(html, PAGE);

    expect(text).toContain("We build warehouse robots");
    expect(text).not.toContain("analytics");
    expect(text).not.toContain("font-family");
  });

  it("resolves links against the page, drops fragments, and keeps only http and https links", () => {
    const html = readFileSync(new URL("./fixtures/static-listing.html", import.meta.url), "utf8");
    const { links } = reduceCareersPage(html, PAGE);
    const urls = links.map((link) => link.url);

    expect(urls).toContain("https://careers.acme.example.test/careers/jobs/101-backend-engineer");
    expect(urls).toContain("https://partners.example.net/acme-apply");
    expect(urls.some((url) => url.startsWith("mailto:") || url.startsWith("javascript:"))).toBe(
      false,
    );
    expect(urls.some((url) => url.includes("#"))).toBe(false);
  });

  it("lists each link once, labelled with its text or its aria-label", () => {
    const html = `<a href="/jobs/1">Backend Engineer</a><a href="/jobs/1">Backend Engineer</a><a href="/jobs/2" aria-label="Data Analyst role"></a>`;
    const { links } = reduceCareersPage(html, PAGE);

    expect(links).toEqual([
      { text: "Backend Engineer", url: "https://careers.acme.example.test/jobs/1" },
      { text: "Data Analyst role", url: "https://careers.acme.example.test/jobs/2" },
    ]);
  });

  it("keeps at most the link cap", () => {
    const html = Array.from(
      { length: MAX_LINKS + 50 },
      (_, index) => `<a href="/jobs/${index}">Role ${index}</a>`,
    ).join("");
    const { links } = reduceCareersPage(html, PAGE);

    expect(links).toHaveLength(MAX_LINKS);
  });
});
