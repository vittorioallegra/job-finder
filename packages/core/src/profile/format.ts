/**
 * Dates and language levels as the profile stores them. A CV writes dates in many shapes
 * ("03/2021", "marzo 2021", "2018", "presente"); the editor's pickers work on one: `YYYY-MM`,
 * `YYYY` or `present`. A date the parser cannot read is kept as written, never guessed.
 */

/** The end date of something still going on. Documents show it in their own language. */
export const PRESENT = "present";

export type ProfileDate = { year: number; month: number | null } | typeof PRESENT;

const PRESENT_WORDS = new Set([
  "present",
  "presente",
  "current",
  "currently",
  "now",
  "today",
  "ongoing",
  "oggi",
  "ad oggi",
  "attuale",
  "attualmente",
  "in corso",
]);

/** Month names and their usual abbreviations, English and Italian, keyed to 1–12. */
const MONTHS: Record<string, number> = {};
const MONTH_NAMES = [
  ["january", "jan", "gennaio", "gen"],
  ["february", "feb", "febbraio"],
  ["march", "mar", "marzo"],
  ["april", "apr", "aprile"],
  ["may", "maggio", "mag"],
  ["june", "jun", "giugno", "giu"],
  ["july", "jul", "luglio", "lug"],
  ["august", "aug", "agosto", "ago"],
  ["september", "sep", "sept", "settembre", "set"],
  ["october", "oct", "ottobre", "ott"],
  ["november", "nov", "novembre"],
  ["december", "dec", "dicembre", "dic"],
];
MONTH_NAMES.forEach((names, index) => {
  for (const name of names) MONTHS[name] = index + 1;
});

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

function date(year: number, month: number | null): ProfileDate | null {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) return null;
  if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) return null;
  return { year, month };
}

/** Reads a CV date, or null when its shape is not one of the known ones. */
export function parseProfileDate(text: string): ProfileDate | null {
  const value = text.trim().toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "");
  if (value === "") return null;
  if (PRESENT_WORDS.has(value)) return PRESENT;
  let match = /^(\d{4})$/.exec(value);
  if (match) return date(Number(match[1]), null);
  match = /^(\d{4})[-/.](\d{1,2})$/.exec(value);
  if (match) return date(Number(match[1]), Number(match[2]));
  match = /^(\d{1,2})[-/.](\d{4})$/.exec(value);
  if (match) return date(Number(match[2]), Number(match[1]));
  match = /^\d{1,2}[-/.](\d{1,2})[-/.](\d{4})$/.exec(value);
  if (match) return date(Number(match[2]), Number(match[1]));
  match = /^([a-zà-ù]+)\.? (\d{4})$/.exec(value);
  if (match) {
    const month = MONTHS[match[1] ?? ""];
    return month === undefined ? null : date(Number(match[2]), month);
  }
  return null;
}

/** The stored form of a date: `YYYY-MM`, `YYYY` or `present`. */
export function formatProfileDate(value: ProfileDate): string {
  if (value === PRESENT) return PRESENT;
  return value.month === null
    ? String(value.year)
    : `${value.year}-${String(value.month).padStart(2, "0")}`;
}

/** CEFR levels, plus native speaker. Stored as these codes; screens and documents name them. */
export const LANGUAGE_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2", "native"] as const;
export type LanguageLevel = (typeof LANGUAGE_LEVELS)[number];

const NATIVE_WORDS =
  /\b(native|mother tongue|madrelingua|lingua madre|nativo|nativa|bilingual|bilingue)\b/i;

/** The level a CV states, as a CEFR code or `native`; null when it names none ("fluent", "good"). */
export function parseLanguageLevel(text: string): LanguageLevel | null {
  if (NATIVE_WORDS.test(text)) return "native";
  const cefr = /\b([ABC][12])\b/i.exec(text);
  return cefr ? (cefr[1]!.toUpperCase() as LanguageLevel) : null;
}
