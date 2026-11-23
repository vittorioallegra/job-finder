import { countryCodeFor } from "./countries";
import type { JobLocation } from "./job";
import { foldForMatch } from "./text";

const REMOTE_WORD = /\b(remote|remoto|remota|hybrid|hybride|ibrido|on site|onsite)\b/;

/**
 * Location from free text such as "Berlin, Germany", "Berlin - Berlin, Deutschland" or
 * "Remote - Italy". The last part that names a country gives the country code, the first other
 * part is the city and the next one the region. A location that says "remote" carries no city:
 * the remote scope is read separately.
 */
export function normalizeLocation(raw: string): JobLocation {
  const parts = raw
    .split(/\s*[,;|]\s*|\s+[-–—]\s+/)
    .map((part) => part.trim())
    .filter((part) => part !== "");

  let countryIndex = -1;
  let countryCode: string | undefined;
  parts.forEach((part, index) => {
    const code = countryCodeFor(part);
    if (code !== undefined) {
      countryIndex = index;
      countryCode = code;
    }
  });

  const location: JobLocation = { raw };
  if (countryCode !== undefined) location.countryCode = countryCode;
  if (REMOTE_WORD.test(foldForMatch(raw))) return location;

  const others = parts.filter((_, index) => index !== countryIndex);
  const city = others[0];
  const region = others[1];
  if (city !== undefined) location.city = city;
  if (region !== undefined) location.region = region;
  return location;
}

/** Location from structured parts (ATS fields). The raw text is kept for display. */
export function locationFromParts(parts: {
  city?: string | null;
  region?: string | null;
  country?: string | null;
  countryCode?: string | null;
  raw?: string | null;
}): JobLocation | undefined {
  const city = clean(parts.city);
  const region = clean(parts.region);
  const country = clean(parts.country);
  const code = clean(parts.countryCode);
  const countryCode =
    code !== undefined && /^[A-Za-z]{2}$/.test(code)
      ? code.toUpperCase()
      : country !== undefined
        ? countryCodeFor(country)
        : undefined;
  const raw = clean(parts.raw) ?? [city, region, country].filter(Boolean).join(", ");
  if (raw === "") return undefined;

  const location: JobLocation = { raw };
  if (city !== undefined) location.city = city;
  if (region !== undefined) location.region = region;
  if (countryCode !== undefined) location.countryCode = countryCode;
  return location;
}

function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
