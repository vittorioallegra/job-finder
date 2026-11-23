import type { VisaSponsorship } from "./job";
import { foldForMatch } from "./text";

const NEGATIVE = [
  /\b(no|not|without|unable to|cannot|can t|won t|will not|don t|do not|senza|non)\b[^.;]{0,40}\bsponsor\w*/,
  /\bsponsor\w*\b[^.;]{0,30}\b(not available|not provided|not offered|unavailable|not possible|not considered)\b/,
];

const POSITIVE = [
  /\bsponsor\w*\b[^.;]{0,30}\b(available|provided|offered|possible|considered)\b/,
  /\b(we|will|can|able to) (sponsor|offer visa|provide visa)\b/,
  /\brelocation (and|&) visa\b/,
  /\bvisa support\b/,
];

/**
 * Visa sponsorship from a posting's text. Negative statements win over positive ones, so
 * "we do not sponsor visas" is "no". Anything else is "unknown".
 */
export function visaSponsorshipFrom(text: string): VisaSponsorship {
  const folded = foldForMatch(text);
  if (NEGATIVE.some((pattern) => pattern.test(folded))) return "no";
  if (POSITIVE.some((pattern) => pattern.test(folded))) return "yes";
  return "unknown";
}
