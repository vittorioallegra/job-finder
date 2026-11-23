import { foldForMatch } from "./text";
import type { EmploymentType } from "./job";

// Order matters: "part time" must win over "full time" in "full or part time", and "temporary"
// over "contract" for "tempo determinato".
const RULES: Array<[EmploymentType, RegExp]> = [
  ["internship", /\b(intern|internship|trainee|tirocinio|praktikum)\b/],
  ["freelance", /\b(freelance|freelancer|self employed)\b/],
  ["temporary", /\b(temporary|temp|interim|tempo determinato|befristet)\b/],
  ["contract", /\b(contract|contractor|fixed term)\b/],
  ["part_time", /\b(part time|parttime|teilzeit|tempo parziale|working student|mini job)\b/],
  [
    "full_time",
    /\b(full time|fulltime|vollzeit|tempo pieno|permanent|unbefristet|tempo indeterminato)\b/,
  ],
];

/** Employment type from a free-text label such as "Full-time" or "Regular Full Time (Salary)". */
export function employmentTypeFrom(text: string | undefined): EmploymentType {
  if (text === undefined) return "unknown";
  const folded = foldForMatch(text);
  for (const [type, pattern] of RULES) {
    if (pattern.test(folded)) return type;
  }
  return "unknown";
}
