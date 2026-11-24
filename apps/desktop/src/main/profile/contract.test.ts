// protects=the bridge contract and the core CV layer agree on the upload limit and on every failure code, so the renderer never shows a code the engine cannot produce;
// fails_when=the bridge upload limit differs from the core limit, a core CV or AI error code is missing from the bridge list, or a bridge code has no core producer;
// no_claim=the codes the engine emits at run time are not checked here, only the static lists they come from.
import { describe, expect, it } from "vitest";
import { AI_ERROR_CODES } from "@job-finder/core/ai";
import { CV_DOCUMENT_ERROR_CODES, CV_MAX_BYTES } from "@job-finder/core/cv";
import { CV_IMPORT_FAILURE_CODES, CV_UPLOAD_MAX_BYTES } from "@job-finder/bridge";

describe("CV contract agreement with core", () => {
  it("uses the same upload limit as the CV reader", () => {
    expect(CV_UPLOAD_MAX_BYTES).toBe(CV_MAX_BYTES);
  });

  it("lists every CV and AI error code, and nothing the core layers cannot produce", () => {
    const producible = new Set<string>([
      ...CV_DOCUMENT_ERROR_CODES,
      ...AI_ERROR_CODES,
      "consent-required",
      "engine-unavailable",
      "cancelled",
    ]);
    for (const code of producible) {
      expect(CV_IMPORT_FAILURE_CODES).toContain(code);
    }
    for (const code of CV_IMPORT_FAILURE_CODES) {
      expect(producible.has(code)).toBe(true);
    }
  });
});
