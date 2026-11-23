// protects=the company and run-cancel payloads accept an http or https careers URL and a run id, and reject any other URL scheme, an empty name or an unknown field before main uses them;
// fails_when=a file, javascript or empty URL is accepted as a careers URL, a blank name passes, or an extra field is ignored instead of rejected;
// no_claim=the schemas do not check that a careers URL exists or that its board can be read; main's detection and the adapters cover that.
import { describe, expect, it } from "vitest";
import { CompanyAddRequestSchema, IngestCancelRequestSchema, IPC_REQUEST_SCHEMAS } from "./index";

describe("ingestion payload contract", () => {
  it("accepts an http or https careers URL and trims the name", () => {
    expect(
      CompanyAddRequestSchema.parse({
        name: "  Acme  ",
        careersUrl: "https://boards.greenhouse.io/acme",
      }),
    ).toEqual({ name: "Acme", careersUrl: "https://boards.greenhouse.io/acme" });
    expect(
      CompanyAddRequestSchema.safeParse({ name: "Acme", careersUrl: "http://example.test/careers" })
        .success,
    ).toBe(true);
  });

  it("rejects other URL schemes, a non-URL, a blank name and an unknown field", () => {
    const withUrl = (careersUrl: string) => ({ name: "Acme", careersUrl });
    expect(CompanyAddRequestSchema.safeParse(withUrl("file:///etc/passwd")).success).toBe(false);
    expect(CompanyAddRequestSchema.safeParse(withUrl("javascript:alert(1)")).success).toBe(false);
    expect(CompanyAddRequestSchema.safeParse(withUrl("not a url")).success).toBe(false);
    expect(
      CompanyAddRequestSchema.safeParse({ name: "   ", careersUrl: "https://x.test" }).success,
    ).toBe(false);
    expect(
      CompanyAddRequestSchema.safeParse({ name: "Acme", careersUrl: "https://x.test", extra: 1 })
        .success,
    ).toBe(false);
  });

  it("requires a run id to cancel and registers every ingestion channel", () => {
    expect(IngestCancelRequestSchema.safeParse({ runId: "run-1" }).success).toBe(true);
    expect(IngestCancelRequestSchema.safeParse({ runId: "" }).success).toBe(false);
    expect(Object.keys(IPC_REQUEST_SCHEMAS)).toEqual(
      expect.arrayContaining([
        "companies:list",
        "companies:add",
        "jobs:list",
        "ingest:start",
        "ingest:cancel",
        "ingest:latest",
      ]),
    );
  });
});
