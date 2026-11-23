// protects=the profile contract accepts only well-formed CV uploads and valid profiles and classifies AI endpoints as cloud or local, and rejects oversized or unconsented uploads and invalid profiles before main uses them;
// fails_when=a loopback OpenAI-compatible endpoint is treated as cloud or a remote one as local, an oversized or non-binary upload passes, or an invalid profile reaches the save channel;
// no_claim=the contract does not check that a file is a real CV or that a local endpoint is actually running; agreement with the core limits and codes is tested in apps/desktop.
import { describe, expect, it } from "vitest";
import { emptyProfile } from "@job-finder/core/profile";
import {
  CV_UPLOAD_MAX_BYTES,
  CvImportRequestSchema,
  IPC_REQUEST_SCHEMAS,
  isCloudAiEndpoint,
} from "./index";

describe("profile contract", () => {
  it("accepts a CV upload with consent and rejects oversized, non-binary or unconsented ones", () => {
    const ok = { fileName: "cv.pdf", bytes: new Uint8Array([1, 2, 3]), consent: true };
    expect(CvImportRequestSchema.safeParse(ok).success).toBe(true);
    expect(
      CvImportRequestSchema.safeParse({ ...ok, bytes: new Uint8Array(CV_UPLOAD_MAX_BYTES + 1) })
        .success,
    ).toBe(false);
    expect(CvImportRequestSchema.safeParse({ ...ok, bytes: "not bytes" }).success).toBe(false);
    expect(CvImportRequestSchema.safeParse({ ...ok, consent: undefined }).success).toBe(false);
    expect(CvImportRequestSchema.safeParse({ ...ok, path: "/etc/passwd" }).success).toBe(false);
  });

  it("rejects an invalid profile on the save channel", () => {
    const schema = IPC_REQUEST_SCHEMAS["profile:save"];
    expect(schema.safeParse(emptyProfile()).success).toBe(true);
    const invalid = { ...emptyProfile(), links: [{ label: "x", url: "file:///etc/passwd" }] };
    expect(schema.safeParse(invalid).success).toBe(false);
  });
});

describe("cloud endpoint check", () => {
  it("treats Anthropic and OpenAI as cloud", () => {
    expect(isCloudAiEndpoint({ provider: "anthropic", baseUrl: "" })).toBe(true);
    expect(isCloudAiEndpoint({ provider: "openai", baseUrl: "http://localhost:1" })).toBe(true);
  });

  it("treats loopback OpenAI-compatible endpoints as local and remote ones as cloud", () => {
    const compatible = (baseUrl: string) =>
      isCloudAiEndpoint({ provider: "openai-compatible", baseUrl });
    expect(compatible("http://localhost:11434/v1")).toBe(false);
    expect(compatible("http://127.0.0.1:1234/v1")).toBe(false);
    expect(compatible("http://models.localhost:8080/v1")).toBe(false);
    expect(compatible("https://api.example.com/v1")).toBe(true);
    expect(compatible("")).toBe(true);
    expect(compatible("not a url")).toBe(true);
  });
});
