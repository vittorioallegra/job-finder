// protects=documentLanguageFor picks the posting's language when the documents support it, and falls back to the UI language for a missing or unsupported posting language;
// fails_when=a supported posting language is ignored, an unsupported one (de, fr) or a missing one is used instead of the UI language, or the source reported does not match the language chosen;
// no_claim=the posting language itself comes from the heuristic in normalize and is not tested here; only the choice between the two sides is;
import { describe, expect, it } from "vitest";
import { documentLanguageFor } from "./language";

describe("documentLanguageFor", () => {
  it("uses the posting's language when the documents support it", () => {
    expect(documentLanguageFor("it", "en")).toEqual({ language: "it", source: "posting" });
    expect(documentLanguageFor("en", "it")).toEqual({ language: "en", source: "posting" });
  });

  it("falls back to the UI language for a missing or unsupported posting language", () => {
    expect(documentLanguageFor(undefined, "it")).toEqual({ language: "it", source: "ui" });
    expect(documentLanguageFor(null, "en")).toEqual({ language: "en", source: "ui" });
    expect(documentLanguageFor("de", "it")).toEqual({ language: "it", source: "ui" });
    expect(documentLanguageFor("fr", "en")).toEqual({ language: "en", source: "ui" });
  });
});
