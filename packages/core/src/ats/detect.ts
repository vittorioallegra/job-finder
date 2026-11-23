import type { AtsId } from "./types";

export interface AtsDetection {
  ats: AtsId;
  /** Board token, when the URL or page names it. */
  slug?: string;
}

interface UrlRule {
  ats: AtsId;
  /** Matched against `host + path` of a URL. The first capture group is the board token. */
  pattern: RegExp;
}

const RESERVED_SLUGS = new Set(["www", "api", "embed", "app"]);

// Order matters: the Greenhouse embed script names its board in `?for=`, not in the path.
const URL_RULES: UrlRule[] = [
  {
    ats: "greenhouse",
    pattern:
      /^boards(?:\.eu)?\.greenhouse\.io\/embed\/job_board[^?]*\?(?:.*&)?for=([A-Za-z0-9_-]+)/,
  },
  {
    ats: "greenhouse",
    pattern: /^(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/([A-Za-z0-9_-]+)/,
  },
  { ats: "lever", pattern: /^jobs(?:\.eu)?\.lever\.co\/([A-Za-z0-9._-]+)/ },
  { ats: "ashby", pattern: /^jobs\.ashbyhq\.com\/([A-Za-z0-9._-]+)/ },
  { ats: "workable", pattern: /^apply\.workable\.com\/([A-Za-z0-9._-]+)/ },
  { ats: "smartrecruiters", pattern: /^(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9._-]+)/ },
  { ats: "personio", pattern: /^([a-z0-9-]+)\.jobs\.personio\.(?:de|com)/ },
  { ats: "recruitee", pattern: /^([a-z0-9-]+)\.recruitee\.com/ },
  { ats: "teamtailor", pattern: /^([a-z0-9-]+)\.teamtailor\.com/ },
];

/** ATS and board token from one URL, or undefined when the URL is not an ATS board. */
export function detectAtsFromUrl(url: string): AtsDetection | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
  const target = `${parsed.host.toLowerCase()}${parsed.pathname}${parsed.search}`;
  for (const rule of URL_RULES) {
    const slug = rule.pattern.exec(target)?.[1];
    if (slug === undefined) continue;
    return RESERVED_SLUGS.has(slug.toLowerCase()) ? { ats: rule.ats } : { ats: rule.ats, slug };
  }
  return undefined;
}

/**
 * ATS embedded in a careers page. The page's own links and embed URLs are checked in order, so
 * a page that links its ATS board reveals both the ATS and the board token.
 */
export function detectAtsFromPage(html: string): AtsDetection | undefined {
  for (const match of html.matchAll(/https?:\/\/[^\s"'<>)]+/g)) {
    const detection = detectAtsFromUrl(match[0]);
    if (detection) return detection;
  }
  return undefined;
}

/**
 * Routes a careers URL to its ATS. Checks the URL first, then the page when one is given.
 * Returns undefined when neither names an ATS: the generic careers page adapter handles those.
 */
export function detectAts(input: { url: string; html?: string }): AtsDetection | undefined {
  return detectAtsFromUrl(input.url) ?? (input.html ? detectAtsFromPage(input.html) : undefined);
}
