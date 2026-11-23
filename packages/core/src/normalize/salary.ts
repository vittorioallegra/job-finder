import type { Salary, SalaryPeriod } from "./job";
import { foldForMatch } from "./text";

const SYMBOLS: Array<[RegExp, string]> = [
  [/€/, "EUR"],
  [/£/, "GBP"],
  [/\$/, "USD"],
  [/¥/, "JPY"],
];
const CODE = /\b(eur|usd|gbp|chf|sek|pln|cad|aud|dkk|nok)\b/i;

const PERIODS: Array<[SalaryPeriod, RegExp]> = [
  ["year", /\b(year|yr|annum|annual|yearly|anno|jahr)\b/],
  ["month", /\b(month|monthly|mese|mensile)\b/],
  ["week", /\b(week|weekly|settimana)\b/],
  ["day", /\b(day|daily|giorno)\b/],
  ["hour", /\b(hour|hourly|hr|ora)\b/],
];

const AMOUNT = /(\d[\d.,' ]*\d|\d)\s*(k)?(?=\W|$)/gi;

/**
 * Salary stated in a posting, e.g. "€50,000 - €60,000 per year" or "$120k-$140k a year".
 * Needs a currency: a bare number is never read as a salary. Returns undefined otherwise.
 */
export function parseSalaryText(text: string): Salary | undefined {
  const currency =
    SYMBOLS.find(([symbol]) => symbol.test(text))?.[1] ?? CODE.exec(text)?.[1]?.toUpperCase();
  if (!currency) return undefined;

  const folded = foldForMatch(text);
  const period = PERIODS.find(([, pattern]) => pattern.test(folded))?.[0];

  const amounts: number[] = [];
  for (const match of text.matchAll(AMOUNT)) {
    const value = toAmount(match[1] ?? "", match[2] !== undefined);
    if (value !== undefined) amounts.push(value);
  }
  if (amounts.length === 0) return undefined;

  const salary: Salary = { currency };
  const min = amounts[0];
  const max = amounts.length > 1 ? amounts[1] : undefined;
  if (min !== undefined) salary.min = min;
  if (max !== undefined) salary.max = max;
  if (period !== undefined) salary.period = period;
  return salary;
}

/**
 * "50,000", "50.000", "9'000", "120k" and "1.234,50" all parse. When both separators appear, the
 * last one is the decimal point. A lone separator followed by exactly three digits is a thousands
 * separator.
 */
function toAmount(raw: string, kilo: boolean): number | undefined {
  let value = raw.replace(/[' ]/g, "");
  const dots = (value.match(/\./g) ?? []).length;
  const commas = (value.match(/,/g) ?? []).length;
  if (dots > 0 && commas > 0) {
    const decimal = value.lastIndexOf(".") > value.lastIndexOf(",") ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    value = value.split(thousands).join("").replace(decimal, ".");
  } else if (dots + commas > 1) {
    value = value.replace(/[.,]/g, "");
  } else if (dots + commas === 1) {
    const separator = dots === 1 ? "." : ",";
    const [, tail = ""] = value.split(separator);
    if (tail.length === 3 && !kilo) value = value.replace(separator, "");
    else value = value.replace(separator, ".");
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return undefined;
  return kilo ? number * 1000 : number;
}
