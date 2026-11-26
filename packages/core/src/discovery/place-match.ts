import { MAX_POSTING_AGE_DAYS } from "../filters/schema";
import { foldForMatch, remoteScopeTerms, resolvePlace, type NormalizedJob } from "../normalize";

const MODE_WORDS = new Set(["remote", "remoto", "remota", "hybrid", "ibrido", "onsite"]);

const SCOPE_PUNCTUATION = /[-/,();:|.&]/g;

/**
 * Whether a posting is in the places, as the jobs list will judge it: a location in one of the
 * countries, a remote scope that reaches them, a remote posting that names no place, or a city
 * place found in a location. No place to judge by keeps every posting. `remoteWithoutScope: false`
 * drops a remote posting that names neither a place nor a scope (it cannot be told to be in reach).
 */
export function jobMatchesPlaces(
  job: NormalizedJob,
  places: readonly string[],
  options: { remoteWithoutScope?: boolean } = {},
): boolean {
  const countries = new Set<string>();
  const cities: string[] = [];
  for (const place of places) {
    if (MODE_WORDS.has(foldForMatch(place))) continue;
    const resolved = resolvePlace(place);
    if (resolved.kind === "countries") resolved.codes.forEach((code) => countries.add(code));
    else if (resolved.text !== "") cities.push(foldForMatch(resolved.text));
  }
  if (countries.size === 0 && cities.length === 0) return true;

  for (const city of cities) {
    if (
      job.locations.some((location) =>
        [location.raw, location.city, location.region].some(
          (text) => text !== undefined && foldForMatch(text).includes(city),
        ),
      )
    ) {
      return true;
    }
  }
  if (countries.size === 0) return job.workMode === "remote";

  if (job.locations.some((l) => l.countryCode !== undefined && countries.has(l.countryCode))) {
    return true;
  }
  if (job.remoteScope !== undefined) {
    const scope = ` ${job.remoteScope.toLowerCase().replace(SCOPE_PUNCTUATION, " ")} `;
    return remoteScopeTerms([...countries]).some((term) => scope.includes(` ${term} `));
  }
  const namesCountry = job.locations.some((location) => location.countryCode !== undefined);
  return (
    (options.remoteWithoutScope ?? true) &&
    !namesCountry &&
    (job.workMode === "remote" || job.locations.length === 0)
  );
}

/**
 * Whether a posting is recent enough to keep: one with a posting date older than the age limit is
 * not stored (job directories keep dead postings online for months); one without a date is kept.
 */
export function isFreshPosting(
  job: NormalizedJob,
  maxAgeDays: number = MAX_POSTING_AGE_DAYS,
  now: number = Date.now(),
): boolean {
  if (job.postedAt === undefined) return true;
  const posted = Date.parse(job.postedAt);
  return Number.isNaN(posted) || posted >= now - maxAgeDays * 24 * 60 * 60 * 1000;
}
