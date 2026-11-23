import { foldForMatch } from "./text";

/**
 * Codes CLDR lists as regions but that are not countries, so a location such as "European Union"
 * is never read as a country.
 */
const NOT_COUNTRIES = new Set(["EU", "EZ", "UN", "QO", "AC", "TA"]);

const ALIASES: Record<string, string> = {
  uk: "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "northern ireland": "GB",
  usa: "US",
  "u s": "US",
  "u s a": "US",
  "united states of america": "US",
  uae: "AE",
  holland: "NL",
};

let index: Map<string, string> | undefined;

function buildIndex(): Map<string, string> {
  const map = new Map<string, string>();
  for (const locale of ["en", "it", "de"]) {
    const names = new Intl.DisplayNames([locale], { type: "region" });
    for (const first of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      for (const second of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
        const code = first + second;
        if (NOT_COUNTRIES.has(code)) continue;
        const name = names.of(code);
        if (name && name !== code) map.set(foldForMatch(name), code);
      }
    }
  }
  for (const [alias, code] of Object.entries(ALIASES)) map.set(alias, code);
  return map;
}

function countryIndex(): Map<string, string> {
  index ??= buildIndex();
  return index;
}

/**
 * ISO 3166-1 alpha-2 code for a country name (English, Italian or German) or a two-letter code.
 * Returns undefined for anything else, including regions such as "European Union".
 */
export function countryCodeFor(value: string): string | undefined {
  const folded = foldForMatch(value.replace(/\./g, ""));
  if (folded === "") return undefined;
  const alias = ALIASES[folded];
  if (alias !== undefined) return alias;
  if (/^[a-z]{2}$/.test(folded)) {
    const code = folded.toUpperCase();
    return NOT_COUNTRIES.has(code) || !isKnownRegion(code) ? undefined : code;
  }
  return countryIndex().get(folded);
}

function isKnownRegion(code: string): boolean {
  return new Intl.DisplayNames(["en"], { type: "region" }).of(code) !== code;
}
