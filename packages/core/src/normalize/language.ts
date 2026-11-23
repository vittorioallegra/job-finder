/**
 * Posting language by stop-word counts. A heuristic for a few common languages: it returns
 * undefined for short or mixed text rather than guessing.
 */
const STOP_WORDS: Array<[string, Set<string>]> = [
  [
    "en",
    new Set(["the", "and", "with", "you", "will", "our", "for", "are", "this", "have", "your"]),
  ],
  [
    "it",
    new Set(["il", "di", "che", "per", "con", "una", "sei", "della", "nel", "anche", "siamo"]),
  ],
  ["de", new Set(["und", "mit", "der", "die", "das", "wir", "sie", "fur", "ein", "eine", "nicht"])],
  ["fr", new Set(["le", "les", "et", "des", "avec", "vous", "nous", "pour", "une", "dans"])],
  ["es", new Set(["el", "los", "para", "una", "nuestro", "del", "las", "por", "usted", "somos"])],
  ["pl", new Set(["oraz", "jest", "dla", "sie", "nie", "praca", "wraz", "lub"])],
];

const MIN_WORDS = 20;
const MIN_HITS = 3;

export function detectLanguage(text: string): string | undefined {
  const words = text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .match(/\p{L}+/gu);
  if (!words || words.length < MIN_WORDS) return undefined;

  let best: { code: string; hits: number } | undefined;
  for (const [code, stop] of STOP_WORDS) {
    const hits = words.filter((word) => stop.has(word)).length;
    if (!best || hits > best.hits) best = { code, hits };
  }
  return best && best.hits >= MIN_HITS ? best.code : undefined;
}
