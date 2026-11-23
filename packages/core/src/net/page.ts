import type { HttpClient } from "./http";

/** Why the hidden page loader could not return a page. */
export type PageRenderErrorCode =
  "invalid-url" | "blocked-by-robots" | "timeout" | "load-failed" | "too-large" | "unknown";

export type PageRenderResult =
  { ok: true; url: string; html: string } | { ok: false; code: PageRenderErrorCode };

/**
 * Wraps the transport that asks main to render a page. The URL is resolved (fixture override) and
 * checked against robots.txt before anything is sent, so main only ever sees allowed URLs.
 */
export function guardPageRender(
  client: Pick<HttpClient, "resolve" | "isAllowed">,
  send: (url: string) => Promise<PageRenderResult>,
): (url: string) => Promise<PageRenderResult> {
  return async (url) => {
    const target = client.resolve(url);
    if (target === undefined) {
      return { ok: false, code: "invalid-url" };
    }
    if (!(await client.isAllowed(target))) {
      return { ok: false, code: "blocked-by-robots" };
    }
    return send(target);
  };
}
