import { originOf } from "../security/origin";

/** Protocols a page may load as subresources (scripts, images, styles, fetches). Everything else is refused. */
const SUBRESOURCE_PROTOCOLS = new Set(["http:", "https:", "data:", "blob:"]);

/** Parses a page URL from the engine. Only absolute http and https URLs are pages. */
export function parsePageUrl(value: unknown): URL | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Compares scheme and host, so `app://` and other non-special schemes work. */
export function isSameOrigin(url: string, origin: string): boolean {
  return originOf(url) === origin;
}

export function isAllowedSubresource(url: string): boolean {
  try {
    return SUBRESOURCE_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}
