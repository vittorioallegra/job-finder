import { countryCodeFor } from "./countries";
import { foldForMatch } from "./text";

const EU = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
] as const;

const EEA = [...EU, "IS", "LI", "NO"];

const EUROPE = [
  ...EEA,
  "CH",
  "GB",
  "AL",
  "AD",
  "AM",
  "AZ",
  "BY",
  "BA",
  "GE",
  "XK",
  "MD",
  "MC",
  "ME",
  "MK",
  "RS",
  "SM",
  "TR",
  "UA",
  "VA",
];

/** An area a person may name and a posting may state as its remote scope. */
export interface GeoArea {
  /** Stable id, shown nowhere. */
  id: string;
  /** Names in the languages a posting or a person writes, compared after folding. */
  names: string[];
  countries: readonly string[];
}

export const GEO_AREAS: readonly GeoArea[] = [
  {
    id: "eu",
    names: [
      "eu",
      "e u",
      "ue",
      "european union",
      "unione europea",
      "europaische union",
      "europeische union",
    ],
    countries: EU,
  },
  {
    id: "eea",
    names: ["eea", "european economic area", "spazio economico europeo"],
    countries: EEA,
  },
  {
    id: "europe",
    names: ["europe", "europa", "european", "europeo", "europaisch"],
    countries: EUROPE,
  },
  {
    id: "emea",
    names: ["emea"],
    countries: [...EUROPE, "AE", "SA", "IL", "EG", "ZA", "MA", "NG", "KE"],
  },
  { id: "dach", names: ["dach"], countries: ["DE", "AT", "CH"] },
  {
    id: "nordics",
    names: ["nordics", "nordic", "scandinavia", "paesi nordici"],
    countries: ["DK", "FI", "IS", "NO", "SE"],
  },
  { id: "benelux", names: ["benelux"], countries: ["BE", "NL", "LU"] },
  {
    id: "north-america",
    names: ["north america", "nord america", "nordamerika"],
    countries: ["US", "CA", "MX"],
  },
  {
    id: "latam",
    names: ["latam", "latin america", "america latina"],
    countries: ["MX", "BR", "AR", "CL", "CO", "PE", "UY"],
  },
  {
    id: "apac",
    names: ["apac", "asia pacific"],
    countries: ["AU", "NZ", "JP", "SG", "IN", "CN", "KR", "HK", "TW", "MY", "TH", "VN", "PH", "ID"],
  },
];

/** Words that say a remote role has no country limit. */
export const WORLDWIDE_TERMS = [
  "worldwide",
  "world wide",
  "global",
  "globally",
  "anywhere",
  "everywhere",
  "any location",
  "tutto il mondo",
  "ovunque",
  "weltweit",
];

/** The area a text names ("EU", "Europa", "Unione Europea"), or undefined. */
export function geoAreaFor(text: string): GeoArea | undefined {
  const folded = foldForMatch(text);
  if (folded === "") return undefined;
  return GEO_AREAS.find((area) => area.names.includes(folded));
}

/** A place a person typed: a country, an area of countries, or anything else (a city, a region). */
export type ResolvedPlace = { kind: "countries"; codes: string[] } | { kind: "text"; text: string };

export function resolvePlace(text: string): ResolvedPlace {
  const area = geoAreaFor(text);
  if (area) return { kind: "countries", codes: [...area.countries] };
  const code = countryCodeFor(text);
  if (code !== undefined) return { kind: "countries", codes: [code] };
  return { kind: "text", text: text.trim() };
}

/** Every name of a country in English, Italian and German, folded. */
function countryNames(code: string): string[] {
  const names = new Set<string>();
  for (const locale of ["en", "it", "de"]) {
    const name = new Intl.DisplayNames([locale], { type: "region" }).of(code);
    if (name && name !== code) names.add(foldForMatch(name));
  }
  if (code === "GB")
    ["uk", "united kingdom", "great britain", "england"].forEach((n) => names.add(n));
  if (code === "US") ["usa", "u s", "u s a", "united states"].forEach((n) => names.add(n));
  return [...names].filter((name) => name !== "");
}

/**
 * The words in a remote scope that mean it reaches someone living in one of these countries: the
 * country's own name, an area that contains one of them, or a worldwide word. A scope with none of
 * them ("US", "Americas") is closed to them.
 */
export function remoteScopeTerms(countryCodes: readonly string[]): string[] {
  const wanted = new Set(countryCodes);
  const terms = new Set<string>(WORLDWIDE_TERMS);
  for (const code of wanted) for (const name of countryNames(code)) terms.add(name);
  for (const area of GEO_AREAS) {
    if (area.countries.some((code) => wanted.has(code))) area.names.forEach((n) => terms.add(n));
  }
  return [...terms];
}
