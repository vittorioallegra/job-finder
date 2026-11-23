// protects=a SmartRecruiters scan whose page comes back empty while more postings are announced is a failure, so nothing is closed;
// fails_when=the adapter treats an empty page with totalFound above the offset as the end of a complete listing;
// no_claim=the live API: the pages are scripted responses served through the real HTTP client.
import { describe, expect, it } from "vitest";
import { createHttpClient } from "../net";
import { ATS_ADAPTERS } from "./index";

function page(offset: number, ids: string[], totalFound: number): string {
  return JSON.stringify({
    offset,
    totalFound,
    content: ids.map((id) => ({ id, name: `Job ${id}` })),
  });
}

async function scan(pages: string[]) {
  let index = 0;
  const client = createHttpClient({
    fetch: (async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/robots.txt")) return new Response("", { status: 404 });
      return new Response(pages[index++] ?? "", { status: 200 });
    }) as typeof fetch,
    intervalMs: 0,
    sleep: async () => {},
  });
  return ATS_ADAPTERS.smartrecruiters.fetchJobs(
    { ats: "smartrecruiters", slug: "acme", companyName: "Acme" },
    client,
  );
}

describe("smartrecruiters pagination", () => {
  it("reads every page of a complete listing", async () => {
    const result = await scan([page(0, ["1", "2"], 3), page(2, ["3"], 3)]);
    expect(result.ok && result.jobs.length).toBe(3);
  });

  it("fails when a page is empty although more postings were announced", async () => {
    const result = await scan([page(0, ["1", "2"], 5), page(2, [], 5)]);
    expect(result).toMatchObject({ ok: false, code: "invalid-response" });
  });
});
