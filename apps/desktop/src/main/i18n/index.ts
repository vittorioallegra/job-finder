import en from "./en.json";
import it from "./it.json";

export type MainLanguage = "en" | "it";

type Dictionary = { [key: string]: Dictionary | string };

const dictionaries: Record<MainLanguage, Dictionary> = { en, it };

/** Flattens nested JSON into dotted keys, e.g. `startup.failedTitle`. */
export function flattenKeys(node: Dictionary, prefix = ""): string[] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [path] : flattenKeys(value, path);
  });
}

function lookup(dictionary: Dictionary, key: string): string | undefined {
  let node: Dictionary | string | undefined = dictionary;
  for (const part of key.split(".")) {
    if (typeof node !== "object") {
      return undefined;
    }
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** Maps an Electron locale such as `it-IT` to a supported language; English otherwise. */
export function resolveMainLanguage(locale: string): MainLanguage {
  return locale.toLowerCase().startsWith("it") ? "it" : "en";
}

/** Returns a translator for the given language, falling back to English per key. */
export function createTranslator(language: MainLanguage) {
  return (key: string): string => lookup(dictionaries[language], key) ?? lookup(en, key) ?? key;
}

export { dictionaries };
