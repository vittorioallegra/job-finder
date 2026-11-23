// protects=every ATS board has a canonical careers address that detection reads back as the same board, so a discovered company scans the board it was found on;
// fails_when=a canonical address points at another board, a slug is rewritten, or an ATS has no address;
// no_claim=the provider's live URL formats, which the ATS fixtures and the live provider check cover.
import { describe, expect, it } from "vitest";
import { ATS_IDS } from "../ats/types";
import { detectAtsFromUrl } from "../ats/detect";
import { canonicalBoardUrl } from "./boards";

describe("canonical board URLs", () => {
  it.each(ATS_IDS)("%s round-trips through ATS detection", (ats) => {
    const url = canonicalBoardUrl(ats, "acme-co");
    expect(url).toBeDefined();
    expect(detectAtsFromUrl(url ?? "")).toEqual({ ats, slug: "acme-co" });
  });

  it("refuses a slug that the URL rules would not read back as the same board", () => {
    expect(canonicalBoardUrl("greenhouse", "www")).toBeUndefined();
    expect(canonicalBoardUrl("lever", "bad/slug")).toBeUndefined();
  });
});
