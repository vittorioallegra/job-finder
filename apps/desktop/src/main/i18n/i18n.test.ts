// protects=en.json and it.json expose the same main-process keys, so every dialog string exists in Italian;
// fails_when=a key is added to one locale file only, or the translator falls back to the raw key for a known key;
// no_claim=translation wording quality is not checked here.
import { describe, expect, it } from "vitest";
import { createTranslator, dictionaries, flattenKeys, resolveMainLanguage } from "./index";

describe("main process i18n", () => {
  it("has identical keys in en.json and it.json", () => {
    expect(flattenKeys(dictionaries.it).sort()).toEqual(flattenKeys(dictionaries.en).sort());
  });

  it("translates known keys in the requested language", () => {
    expect(createTranslator("it")("startup.failedTitle")).toContain("non è riuscito");
    expect(createTranslator("en")("startup.failedTitle")).toBe("Job Finder could not start");
  });

  it("maps Electron locales to a supported language, defaulting to English", () => {
    expect(resolveMainLanguage("it-IT")).toBe("it");
    expect(resolveMainLanguage("de-DE")).toBe("en");
  });
});
