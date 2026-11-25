// protects=a Teamtailor or Personio feed that changed format fails the scan, while a valid feed with no postings stays a complete empty scan, and a Personio posting whose feed entry has no description gets it from its page without failing the scan when that page cannot be read;
// fails_when=a feed whose items cannot be read returns ok with fewer or no jobs, which would close the company's postings, or a valid empty feed is reported as a failure;
// no_claim=the live feeds: the bodies are small hand-written documents.
import { describe, expect, it } from "vitest";
import { createHttpClient } from "../net";
import { ATS_ADAPTERS } from "./index";
import type { AtsId } from "./types";

async function scan(ats: AtsId, body: string) {
  const client = createHttpClient({
    fetch: (async (input: RequestInfo | URL) =>
      String(input).endsWith("/robots.txt")
        ? new Response("", { status: 404 })
        : new Response(body, { status: 200 })) as typeof fetch,
    intervalMs: 0,
    sleep: async () => {},
  });
  return ATS_ADAPTERS[ats].fetchJobs({ ats, slug: "acme", companyName: "Acme" }, client);
}

describe("XML feed adapters", () => {
  it("fails a Teamtailor feed whose items no longer have the expected fields, and accepts an empty one", async () => {
    const drifted = `<rss><channel><item><title>Dev</title><url>https://x.test/1</url></item></channel></rss>`;
    const empty = `<rss><channel><title>Acme</title></channel></rss>`;
    const partial = `<rss><channel>
      <item><title>A</title><link>https://x.test/1</link><guid>1</guid></item>
      <item><title>B</title></item></channel></rss>`;

    expect(await scan("teamtailor", drifted)).toMatchObject({
      ok: false,
      code: "invalid-response",
    });
    expect(await scan("teamtailor", partial)).toMatchObject({
      ok: false,
      code: "invalid-response",
    });
    expect(await scan("teamtailor", empty)).toEqual({ ok: true, jobs: [] });
  });

  it("fails a Personio feed whose positions no longer have an id and a name, and accepts an empty one", async () => {
    const drifted = `<workzag-jobs><position><jobId>1</jobId><title>Dev</title></position></workzag-jobs>`;
    const empty = `<workzag-jobs></workzag-jobs>`;

    expect(await scan("personio", drifted)).toMatchObject({ ok: false, code: "invalid-response" });
    expect(await scan("personio", empty)).toEqual({ ok: true, jobs: [] });
  });

  it("reads a Personio description from the posting page when the feed leaves it empty", async () => {
    const feed = `<workzag-jobs>
      <position><id>1</id><office>Berlin</office><name>Backend</name><jobDescriptions></jobDescriptions></position>
      <position><id>2</id><office>Berlin</office><name>Frontend</name><jobDescriptions></jobDescriptions></position>
    </workzag-jobs>`;
    const page = `<html><script type="application/ld+json">${JSON.stringify({
      description: "<h1>Your mission</h1><p>Build services.</p>",
    })}</script></html>`;
    const client = createHttpClient({
      fetch: (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
        if (url.endsWith("/xml")) return new Response(feed, { status: 200 });
        return url.endsWith("/job/1")
          ? new Response(page, { status: 200 })
          : new Response("gone", { status: 500 });
      }) as typeof fetch,
      intervalMs: 0,
      sleep: async () => {},
      maxAttempts: 1,
    });

    const result = await ATS_ADAPTERS.personio.fetchJobs(
      { ats: "personio", slug: "acme", companyName: "Acme" },
      client,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jobs.map((job) => job.description)).toEqual([
      "Your mission\nBuild services.",
      "",
    ]);
  });
});
