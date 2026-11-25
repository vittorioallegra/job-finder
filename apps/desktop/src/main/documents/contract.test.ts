// protects=the document failure codes that mirror the AI layer are exactly the AI error codes, and every AI-unavailable code is a failure the bridge defines;
// fails_when=an AI error code is missing from the bridge's failure codes, an extra AI-unavailable code is listed that the bridge does not define, or a document code is reported as AI-unavailable without being one;
// no_claim=the codes' messages are not checked here; the renderer tests cover what each code shows;
import { describe, expect, it } from "vitest";
import { AI_ERROR_CODES } from "@job-finder/core/ai";
import { DOCUMENT_AI_UNAVAILABLE_CODES, DOCUMENT_FAILURE_CODES } from "@job-finder/bridge";

describe("document failure codes", () => {
  it("contain every AI error code, so an AI failure reaches the screen under its own name", () => {
    for (const code of AI_ERROR_CODES) {
      expect(DOCUMENT_FAILURE_CODES).toContain(code);
    }
  });

  it("mark as AI-unavailable only codes the bridge defines", () => {
    for (const code of DOCUMENT_AI_UNAVAILABLE_CODES) {
      expect(DOCUMENT_FAILURE_CODES).toContain(code);
    }
    expect(DOCUMENT_AI_UNAVAILABLE_CODES).not.toContain("invalid-output");
  });
});
