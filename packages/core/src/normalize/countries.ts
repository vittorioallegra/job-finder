import { foldForMatch } from "./text";

/**
 * Codes CLDR lists as regions or deprecated codes, or that are not countries at all. "UK" is a
 * deprecated code for GB and "FX" for France; "EU" is a union. None of them is read from text.
 */
const NOT_COUNTRIES = new Set([
  "AC",
  "AN",
  "BU",
  "CS",
  "DD",
  "EU",
  "EZ",
  "FX",
  "NT",
  "QO",
  "QU",
  "SU",
  "TA",
  "TP",
  "UK",
  "UN",
  "YU",
  "ZR",
]);

/**
 * Names that are also a place inside another country ("Atlanta, Georgia" is a US state). Free
 * text never reads them as countries; structured country codes still do.
 */
const AMBIGUOUS_NAMES = new Set(["georgia"]);

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
        const folded = name ? foldForMatch(name) : "";
        if (name && name !== code && !AMBIGUOUS_NAMES.has(folded)) map.set(folded, code);
      }
    }
  }
  for (const [alias, code] of Object.entries(ALIASES)) map.set(alias, code);
  return map;
}

/**
 * ISO 3166-1 alpha-2 code for a country name in English, Italian or German. Two-letter codes are
 * not read from free text: "CA" is Canada and also California. Structured fields carry their code
 * directly. Returns undefined for anything else, including regions such as "European Union".
 */
export function countryCodeFor(value: string): string | undefined {
  const folded = foldForMatch(value.replace(/\./g, ""));
  if (folded === "") return undefined;
  index ??= buildIndex();
  return index.get(folded);
}

/** Country-code domains that are not a country in practice: marketing and tech domains. */
const NOT_COUNTRY_TLDS = new Set([
  "ac",
  "ai",
  "cc",
  "co",
  "fm",
  "gg",
  "io",
  "ly",
  "me",
  "sh",
  "so",
  "to",
  "tv",
  "vc",
  "ws",
]);

/**
 * The country of a company from the host of its own site: `azienda.it` is Italy, `firma.co.uk` is
 * the United Kingdom. Domains that are only fashionable (`.io`, `.ai`, `.co`) say nothing.
 */
export function countryFromHost(host: string): string | undefined {
  const labels = host.toLowerCase().split(".");
  const tld = labels.at(-1) ?? "";
  if (!/^[a-z]{2}$/.test(tld) || NOT_COUNTRY_TLDS.has(tld)) return undefined;
  if (tld === "uk") return "GB";
  const code = tld.toUpperCase();
  return NOT_COUNTRIES.has(code) ? undefined : code;
}
