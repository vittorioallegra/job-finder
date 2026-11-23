/**
 * Returns `scheme://host[:port]` for a URL, or null when it does not parse. Unlike `URL.origin`,
 * this works for custom standard schemes such as `app://renderer`, whose `origin` is `"null"`.
 */
export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.host === "" ? null : `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}
