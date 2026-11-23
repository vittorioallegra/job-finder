// protects=the discovery request and the company-limited start are validated before any service runs: keywords are required, both lists are capped, unknown fields are refused, and a start names at most one company;
// fails_when=an empty keyword list passes, more than five terms pass, an unknown field passes, or a start accepts an empty or unknown company id;
// no_claim=how the engine uses the terms and the company id, which the core and engine tests cover.
import { describe, expect, it } from "vitest";
import { DiscoverySearchRequestSchema } from "./discovery";
import { IngestStartRequestSchema } from "./ingest";

describe("discovery request schema", () => {
  it("accepts keywords with optional locations", () => {
    expect(DiscoverySearchRequestSchema.parse({ keywords: [" data "], locations: [] })).toEqual({
      keywords: ["data"],
      locations: [],
    });
  });

  it("refuses an empty keyword list, a sixth term, and an unknown field", () => {
    expect(DiscoverySearchRequestSchema.safeParse({ keywords: [], locations: [] }).success).toBe(
      false,
    );
    expect(
      DiscoverySearchRequestSchema.safeParse({
        keywords: ["a", "b", "c", "d", "e", "f"],
        locations: [],
      }).success,
    ).toBe(false);
    expect(
      DiscoverySearchRequestSchema.safeParse({ keywords: ["a"], locations: [], url: "https://x" })
        .success,
    ).toBe(false);
  });
});

describe("ingest start schema", () => {
  it("accepts no payload (every company) or one company id", () => {
    expect(IngestStartRequestSchema.parse(undefined)).toBeUndefined();
    expect(IngestStartRequestSchema.parse({ companyId: "co-1" })).toEqual({ companyId: "co-1" });
  });

  it("refuses an empty company id and unknown fields", () => {
    expect(IngestStartRequestSchema.safeParse({ companyId: "" }).success).toBe(false);
    expect(IngestStartRequestSchema.safeParse({ companyId: "co-1", runId: "x" }).success).toBe(
      false,
    );
  });
});
