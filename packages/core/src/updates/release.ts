import type { HttpClient } from "../net/http";
import { isNewerVersion, parseVersion } from "./version";

/**
 * The GitHub repository whose published releases the update check reads, as `owner/name`.
 * Null until the repository is set: the check then does nothing and no request is made.
 */
export const RELEASES_REPOSITORY: string | null = null;

const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export interface LatestRelease {
  /** The version without its leading `v`. */
  version: string;
  /** The release page on GitHub. */
  url: string;
}

/**
 * `release` is the newer published release, or null when the app is up to date or the repository
 * has no published release. A failure carries a code only, never the response body.
 */
export type UpdateCheckOutcome =
  | { ok: true; release: LatestRelease | null }
  | { ok: false; code: "unavailable" | "invalid-response" };

export interface ReleaseCheckOptions {
  /** The engine's HTTP client: the fixture override, robots.txt and the per-host queue apply. */
  http: HttpClient;
  repository: string;
  currentVersion: string;
  signal?: AbortSignal;
}

interface ReleaseBody {
  tag_name?: unknown;
}

/**
 * Asks GitHub for the latest published release (drafts and pre-releases are never returned by that
 * endpoint) and reports it when it is newer than `currentVersion`.
 */
export async function checkLatestRelease(
  options: ReleaseCheckOptions,
): Promise<UpdateCheckOutcome> {
  const { http, repository, currentVersion, signal } = options;
  if (!REPOSITORY_PATTERN.test(repository)) {
    return { ok: false, code: "unavailable" };
  }
  const result = await http.get(`https://api.github.com/repos/${repository}/releases/latest`, {
    signal,
    headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
  });
  if (!result.ok) {
    // A repository without any published release answers 404; that is not a failure.
    if (result.code === "http-status" && result.status === 404) {
      return { ok: true, release: null };
    }
    return { ok: false, code: "unavailable" };
  }

  let body: ReleaseBody;
  try {
    body = JSON.parse(result.body) as ReleaseBody;
  } catch {
    return { ok: false, code: "invalid-response" };
  }
  const tag = typeof body.tag_name === "string" ? body.tag_name : "";
  const version = parseVersion(tag);
  if (!version) {
    return { ok: false, code: "invalid-response" };
  }
  const normalized = version.join(".");
  if (!isNewerVersion(normalized, currentVersion)) {
    return { ok: true, release: null };
  }
  return {
    ok: true,
    release: {
      version: normalized,
      url: `https://github.com/${repository}/releases/tag/${tag}`,
    },
  };
}
