// protects=en.json and it.json expose the same keys, so no UI string is missing in Italian;
// fails_when=a key is added to one locale file only or renamed in one of them;
// no_claim=translation quality or completeness of wording is not checked here.
import { describe, expect, it } from "vitest";
import en from "./en.json";
import itLocale from "./it.json";

type Json = { [key: string]: Json | string };

function flattenKeys(node: Json, prefix = ""): string[] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [path] : flattenKeys(value, path);
  });
}

describe("web i18n key parity", () => {
  it("has identical keys in en.json and it.json", () => {
    expect(flattenKeys(itLocale as Json).sort()).toEqual(flattenKeys(en as Json).sort());
  });

  it("has no empty translation values", () => {
    for (const key of flattenKeys(itLocale as Json)) {
      const value = key.split(".").reduce<unknown>((node, part) => (node as Json)[part], itLocale);
      expect(value, key).not.toBe("");
    }
  });
});
