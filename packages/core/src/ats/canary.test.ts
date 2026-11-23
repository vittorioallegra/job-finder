// protects=each ATS adapter still reads its public board API at the live endpoint with the shared HTTP client, so a provider that changes its response shape, moves its endpoint or refuses the public request is noticed;
// fails_when=a live board read returns a failure (an HTTP error, robots.txt refusal, or a response the adapter cannot parse);
// no_claim=runs only with JOB_FINDER_LIVE_CANARY=1 (the scheduled canary workflow), so the unit suite never reaches the network; it checks that each read succeeds, not the postings or their count, and it covers the eight boards listed here only.
import { describe, expect, it } from "vitest";
import { createHttpClient } from "../net";
import { ATS_ADAPTERS } from "./index";
import type { AtsId } from "./types";

/** Public demo boards, the same ones the recorded fixtures were taken from (see docs/adding-an-ats-adapter.md). */
const PUBLIC_BOARDS: readonly { ats: AtsId; slug: string }[] = [
  { ats: "greenhouse", slug: "stripe" },
  { ats: "lever", slug: "leverdemo" },
  { ats: "ashby", slug: "ashby" },
  { ats: "workable", slug: "flosum" },
  { ats: "smartrecruiters", slug: "smartrecruiters" },
  { ats: "personio", slug: "personio" },
  { ats: "recruitee", slug: "personio" },
  { ats: "teamtailor", slug: "career" },
];

describe.skipIf(process.env["JOB_FINDER_LIVE_CANARY"] !== "1")("live ATS canary", () => {
  for (const board of PUBLIC_BOARDS) {
    it(`reads the ${board.ats} board ${board.slug}`, async () => {
      const http = createHttpClient({ timeoutMs: 30_000 });
      const result = await ATS_ADAPTERS[board.ats].fetchJobs(
        { ats: board.ats, slug: board.slug, companyName: board.slug },
        http,
      );
      expect(result).toMatchObject({ ok: true });
    }, 90_000);
  }
});
