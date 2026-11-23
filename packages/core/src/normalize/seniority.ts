import type { SeniorityLevel } from "./job";
import { foldForMatch } from "./text";

// Checked in this order: "Senior / Lead" is lead and "Mid-Senior" is senior.
const RULES: Array<[SeniorityLevel, RegExp]> = [
  ["lead", /\b(lead|staff|principal|head|director|vp|chief)\b/],
  ["senior", /\b(senior|sr)\b/],
  ["mid", /\b(mid|intermediate|mid[- ]level)\b/],
  ["junior", /\b(junior|jr|entry[- ]level|graduate)\b/],
  ["intern", /\b(intern|internship|trainee|tirocinante|praktikant)\b/],
];

/** Seniority stated in a title or a structured level label. Never inferred from the description. */
export function seniorityFrom(text: string): SeniorityLevel {
  const folded = foldForMatch(text);
  for (const [level, pattern] of RULES) {
    if (pattern.test(folded)) return level;
  }
  return "unknown";
}
