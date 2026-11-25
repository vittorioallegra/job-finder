import { countryCodeFor } from "./countries";

/** The United States, as the scope of a job that only a U.S. worker can take. */
const UNITED_STATES = "United States";

/**
 * Statements that tie a job to the United States even when it is called remote: federal work needs
 * a U.S. citizen or a clearance, and many postings say outright that the applicant must be
 * authorized to work there. The text is lowered and "U.S." is written "us" first.
 */
const US_ONLY = [
  /\b(us|united states|usa)\s+(citizens?|citizenship)\b/,
  /\bcitizen(ship)? of the (us|united states|usa)\b/,
  /\bsecurity clearance\b/,
  /\bfederal (background|contract)\b/,
  /\bmust (be )?(located|based|reside|live|work) (in|within) the (us|united states|usa)\b/,
  /\b(usa|united states)[- ]based\b/,
];

/** "authorized to work in <place>": the place up to the end of the clause. */
const AUTHORIZED_TO_WORK =
  /\b(?:authori[sz]ed|eligible|permitted|legally entitled|legally allowed|have the right) to work (?:in|within) (?:the )?([a-z ]{2,60}?)(?=\s(?:without|with|and|on|at|for|as|by|at the time)\b|[,.;:)]|$)/g;

/**
 * Countries a remote job is open to, read from its description when its location gives no scope:
 * "Applicants must be authorized to work in the United States" and U.S.-only federal requirements.
 * Returns undefined when the text names no country, which keeps the job open to everyone.
 */
export function remoteScopeFromDescription(description: string): string | undefined {
  const folded = plain(description);
  const countries = new Set<string>();

  for (const match of folded.matchAll(AUTHORIZED_TO_WORK)) {
    const place = (match[1] ?? "").trim();
    // "the United States or Canada" is two countries; anything else that is not a country is ignored.
    for (const part of place.split(/\s+(?:or|and)\s+|\s*\/\s*/)) {
      const name = part.replace(/^the\s+/, "").trim();
      if (name === "us" || name === "usa") {
        countries.add(UNITED_STATES);
      } else if (name !== "" && countryCodeFor(name) !== undefined) {
        countries.add(name);
      }
    }
  }
  if (countries.size === 0 && US_ONLY.some((pattern) => pattern.test(folded))) {
    countries.add(UNITED_STATES);
  }
  if (countries.size === 0) return undefined;
  return [...countries].map(titleCase).join(" / ");
}

/** Lower case, no accents, "U.S." as "us" and "U.S.A." as "usa"; the other punctuation stays. */
function plain(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\bu\.s\.a\.?/g, "usa")
    .replace(/\bu\.s\.?(?=\W|$)/g, "us")
    .replace(/\s+/g, " ");
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}
