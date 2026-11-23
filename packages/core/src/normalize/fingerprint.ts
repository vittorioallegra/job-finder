import { createHash } from "node:crypto";
import type { JobLocation, NormalizedJob } from "./job";
import { foldForMatch } from "./text";

const LEGAL_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "limited",
  "plc",
  "corp",
  "corporation",
  "co",
  "gmbh",
  "ag",
  "kg",
  "ug",
  "srl",
  "spa",
  "sas",
  "sarl",
  "bv",
  "sa",
  "ab",
  "oy",
  "as",
]);

/** Company name without legal-form suffixes: "Acme GmbH" and "ACME" compare equal. */
export function normalizeCompany(name: string): string {
  const words = foldForMatch(name.replace(/\./g, "")).split(" ").filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1] ?? "")) words.pop();
  return words.join(" ");
}

// Gender markers in German and English postings, e.g. "(m/w/d)", "(f/m/x)", "(all genders)".
const GENDER_MARKER = /\b[mfdwx](?: [mfdwx]){1,2}\b(?: divers| diverse)?|\ball genders?\b|\bgn\b/g;

/** Title without gender markers, punctuation or case: "Engineer (m/w/d)" equals "engineer". */
export function normalizeTitle(title: string): string {
  return foldForMatch(title.replace(/[/-]/g, " "))
    .replace(GENDER_MARKER, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stable key of one location: country and city when known, otherwise the raw text. */
export function locationKey(location: JobLocation): string {
  const place = location.city ?? location.raw;
  return `${location.countryCode ?? ""}|${foldForMatch(place)}`;
}

/**
 * Fingerprint for cross-source dedupe: company, title and the set of locations. The location set
 * is sorted, so order in the source does not matter.
 */
export function fingerprint(
  job: Pick<NormalizedJob, "companyName" | "title" | "locations">,
): string {
  const locations = [...new Set(job.locations.map(locationKey))].sort();
  const material = [
    normalizeCompany(job.companyName),
    normalizeTitle(job.title),
    locations.join(";"),
  ].join("\u0000");
  return createHash("sha256").update(material).digest("hex");
}

/**
 * Groups jobs that share a fingerprint, keeping the order of the input. A group with more than
 * one job is the same opening seen on several sources.
 */
export function groupByFingerprint<T extends NormalizedJob>(jobs: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const job of jobs) {
    const key = fingerprint(job);
    const group = groups.get(key);
    if (group) group.push(job);
    else groups.set(key, [job]);
  }
  return groups;
}
