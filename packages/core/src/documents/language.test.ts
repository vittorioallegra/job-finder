// protects=documentLanguageFor picks the posting's language when the documents support it, and falls back to English for a missing or unsupported posting language, whatever the UI language is;
// fails_when=a supported posting language is ignored, an unsupported one (de, fr) or a missing one gives anything but English, or the source reported does not match the language chosen;
// no_claim=the posting language itself comes from the heuristic in normalize and is not tested here; only the choice between the two sides is;
import { describe, expect, it } from "vitest";
import { documentLanguageFor } from "./language";

describe("documentLanguageFor", () => {
  it("uses the posting's language when the documents support it", () => {
    expect(documentLanguageFor("it")).toEqual({ language: "it", source: "posting" });
    expect(documentLanguageFor("en")).toEqual({ language: "en", source: "posting" });
  });

  it("falls back to English for a missing or unsupported posting language", () => {
    for (const language of [undefined, null, "de", "fr"]) {
      expect(documentLanguageFor(language)).toEqual({ language: "en", source: "default" });
    }
  });
});
