import { createHash } from "node:crypto";

/** One recorded HTTP exchange. `key` identifies the request; `body` is the sanitized response body. */
export interface FixtureEntry {
  key: string;
  method: string;
  path: string;
  status: number;
  body: string;
}

/** Key for a request: method and path plus the exact request body. The host is left out so recordings replay against any base URL. */
export function fixtureKey(method: string, url: string, body: string): string {
  const { pathname } = new URL(url);
  return createHash("sha256").update(`${method.toUpperCase()} ${pathname}\n${body}`).digest("hex");
}

async function normalize(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<{
  request: Request;
  body: string;
}> {
  const request = new Request(input, init);
  const body =
    request.method === "GET" || request.method === "HEAD" ? "" : await request.clone().text();
  return { request, body };
}

/**
 * Serves recorded responses instead of calling the network. A request without a recording throws,
 * so a test that drifts from its fixture fails with the path it could not find.
 */
export function createReplayFetch(entries: FixtureEntry[]): typeof fetch {
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  return async (input, init) => {
    const { request, body } = await normalize(input, init);
    const key = fixtureKey(request.method, request.url, body);
    const entry = byKey.get(key);
    if (!entry) {
      throw new Error(
        `No recorded response for ${request.method} ${new URL(request.url).pathname}`,
      );
    }
    return new Response(entry.body, {
      status: entry.status,
      headers: { "content-type": "application/json" },
    });
  };
}

export interface RecordingOptions {
  upstream: typeof fetch;
  /** Secret values removed from every recorded response body (for example the API key echoed in an error). */
  redact: readonly string[];
  onRecord: (entry: FixtureEntry) => void;
}

/** Calls the real endpoint and hands each exchange to `onRecord`, with secrets removed from the body. */
export function createRecordingFetch(options: RecordingOptions): typeof fetch {
  const secrets = options.redact.filter((value) => value.length > 0);
  return async (input, init) => {
    const { request, body } = await normalize(input, init);
    const response = await options.upstream(request);
    let text = await response.text();
    for (const secret of secrets) {
      text = text.split(secret).join("[redacted]");
    }
    options.onRecord({
      key: fixtureKey(request.method, request.url, body),
      method: request.method.toUpperCase(),
      path: new URL(request.url).pathname,
      status: response.status,
      body: text,
    });
    return new Response(text, { status: response.status, headers: response.headers });
  };
}
