import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

export const APP_SCHEME = "app";
export const APP_HOST = "renderer";

/**
 * Maps an `app://renderer/<path>` request to a file under `rootDir`. Returns null when the path
 * is malformed or escapes the root, including percent-encoded traversal such as `%2e%2e%2f`.
 */
export function resolveAppRequest(rootDir: string, requestUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.hostname !== APP_HOST) {
    return null;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (decodedPath.includes("\0") || decodedPath.includes("\\")) {
    return null;
  }

  const relativePath =
    decodedPath === "/" || decodedPath === "" ? "index.html" : decodedPath.slice(1);
  const normalized = normalize(relativePath);
  if (isAbsolute(normalized) || normalized.split(sep).includes("..")) {
    return null;
  }

  const root = resolve(rootDir);
  const target = resolve(join(root, normalized));
  const inside = relative(root, target);
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) {
    return null;
  }
  return target;
}
