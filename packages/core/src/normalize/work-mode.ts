import { foldForMatch } from "./text";
import type { WorkMode } from "./job";

const HYBRID = /\b(hybrid|ibrido|ibrida|hybride)\b/;
const ONSITE =
  /\b(on[- ]?site|in office|in person|office based|in sede|in presenza|vor ort|en oficina)\b/;
const REMOTE = /\b(remote|remoto|remota|telecommut\w*|work from home|home office)\b/;

/**
 * Work mode from a short piece of text: a title, a location or a structured workplace field.
 * Callers never pass a whole description, because "remote" appears there in unrelated sentences.
 * Hybrid is checked first, then on-site, then remote.
 */
export function workModeFrom(text: string): WorkMode {
  const folded = foldForMatch(text);
  if (HYBRID.test(folded)) return "hybrid";
  if (ONSITE.test(folded)) return "onsite";
  if (REMOTE.test(folded)) return "remote";
  return "unknown";
}

/** First source that gives a known mode wins, so a structured field beats a guess from text. */
export function resolveWorkMode(...candidates: (string | undefined)[]): WorkMode {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate.trim() === "") continue;
    const mode = workModeFrom(candidate);
    if (mode !== "unknown") return mode;
  }
  return "unknown";
}

/**
 * Scope stated next to "remote", such as "Remote - European Union" (EU) or "Remote (worldwide)".
 * Returns undefined when no scope follows the word.
 */
export function remoteScopeFrom(location: string): string | undefined {
  const match = /\bremote\b\s*(?:[-–—:,(|]\s*)(.+?)\)?\s*$/i.exec(location);
  if (!match) return undefined;
  const scope = match[1]?.trim();
  if (!scope || workModeFrom(scope) !== "unknown") return undefined;
  return scope;
}
