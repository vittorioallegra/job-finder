import PQueue from "p-queue";
import robotsParser from "robots-parser";

/** Sent with every request. Generic on purpose: it names the app and nothing about the user. */
export const JOB_FINDER_USER_AGENT = "Mozilla/5.0 (compatible; job-finder)";

/** The product token matched against `User-agent` lines in robots.txt. */
const ROBOTS_PRODUCT_TOKEN = "job-finder";

const ACCEPT = "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8";
const DEFAULT_INTERVAL_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_ROBOTS_TTL_MS = 60 * 60 * 1000;
const DEFAULT_ROBOTS_FAILURE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;

export type HttpErrorCode =
  | "invalid-url"
  | "blocked-by-robots"
  | "http-status"
  | "timeout"
  | "network"
  | "too-large"
  | "aborted";

export type HttpResult =
  | {
      ok: true;
      /** The URL the request went to, after the fixture override. */
      url: string;
      status: number;
      contentType: string;
      body: string;
      cached: boolean;
    }
  | { ok: false; code: HttpErrorCode; url: string; status?: number };

export interface HttpRequestOptions {
  signal?: AbortSignal;
  /** Extra headers, merged over the client's own (user agent, accept). Requests with headers are not cached. */
  headers?: Record<string, string>;
}

export interface HttpPostOptions extends HttpRequestOptions {
  /** Sent as the request body as typed. Posts are never cached. */
  body: string;
}

/** What one request sends. Built by `get` and `post`; the queue, retries and robots apply to both. */
interface RequestSpec {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

export interface HttpClientOptions {
  /** Defaults to the global `fetch`; tests inject a scripted one. */
  fetch?: typeof fetch;
  /**
   * Env-guarded override (`JOB_FINDER_FIXTURE_BASE_URL`, resolved by the caller). When set, every
   * request keeps its path and query but goes to this origin instead.
   */
  fixtureBaseUrl?: string;
  /** Minimum time between two requests to the same host. The plan requires 1 request per second. */
  intervalMs?: number;
  timeoutMs?: number;
  /** Attempts per request, retries included. Only 429, 5xx and network errors are retried. */
  maxAttempts?: number;
  maxBodyBytes?: number;
  cacheTtlMs?: number;
  robotsTtlMs?: number;
  /** How long a failed robots.txt fetch (5xx, network, timeout) blocks the origin before a retry. */
  robotsFailureTtlMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface HttpClient {
  /**
   * The URL a request to `url` really goes to (fixture override applied), or undefined when `url`
   * is not an absolute http or https URL.
   */
  resolve(url: string): string | undefined;
  /**
   * Whether robots.txt allows fetching `url` (already resolved). Reads and caches the origin's
   * robots.txt through the same per-host queue as page requests.
   */
  isAllowed(url: string): Promise<boolean>;
  get(url: string, options?: HttpRequestOptions): Promise<HttpResult>;
  /** A POST with a body, through the same queue, robots check and retries as `get`. Never cached. */
  post(url: string, options: HttpPostOptions): Promise<HttpResult>;
}

type RobotsRules = (url: string) => boolean;

interface RobotsEntry {
  expiresAt: number;
  allows: RobotsRules;
}

interface CacheEntry {
  expiresAt: number;
  value: { status: number; contentType: string; body: string };
}

/**
 * What one queued attempt produced: network work only. Robots, redirects, retries and caching are
 * decided outside the queue slot, so a queued task never waits on another task of the same host.
 */
type RawAttempt =
  | { kind: "failed"; code: "aborted" | "timeout" | "network" }
  | {
      kind: "response";
      status: number;
      finalUrl: string;
      contentType: string;
      retryAfter: string | null;
      /** Read only for a 2xx response; undefined when the body is larger than the limit. */
      body?: string;
    };

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves a URL to the one actually fetched, or undefined when it is not http(s). */
export function resolveRequestUrl(url: string, fixtureBaseUrl?: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return undefined;
  }
  if (!fixtureBaseUrl) {
    return parsed.toString();
  }
  return `${fixtureBaseUrl.replace(/\/+$/, "")}${parsed.pathname}${parsed.search}`;
}

/**
 * The single HTTP path for the app: a per-host queue (one request per second by default), a
 * cached robots.txt that applies to every request including search providers, an in-memory
 * response cache, and backoff on 429 and 5xx. Callers never bypass it.
 */
export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const robotsTtlMs = options.robotsTtlMs ?? DEFAULT_ROBOTS_TTL_MS;
  const robotsFailureTtlMs = options.robotsFailureTtlMs ?? DEFAULT_ROBOTS_FAILURE_TTL_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;

  const queues = new Map<string, PQueue>();
  const robots = new Map<string, RobotsEntry>();
  const robotsPending = new Map<string, Promise<RobotsEntry>>();
  const cache = new Map<string, CacheEntry>();

  function queueFor(host: string): PQueue {
    let queue = queues.get(host);
    if (!queue) {
      queue = new PQueue({ concurrency: 1, interval: intervalMs, intervalCap: 1 });
      queues.set(host, queue);
    }
    return queue;
  }

  function cacheGet(key: string): CacheEntry["value"] | undefined {
    const entry = cache.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= now()) {
      cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  function cachePut(key: string, value: CacheEntry["value"]): void {
    cache.delete(key);
    if (cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next();
      if (!oldest.done) {
        cache.delete(oldest.value);
      }
    }
    cache.set(key, { expiresAt: now() + cacheTtlMs, value });
  }

  function backoffMs(attempt: number): number {
    return Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_MAX_MS);
  }

  /** Reads a body up to `maxBytes`; undefined when it is larger. */
  async function readBody(response: Response, maxBytes: number): Promise<string | undefined> {
    if (!response.body) {
      return "";
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  }

  function retryDelayMs(header: string | null, attempt: number): number {
    if (header) {
      const seconds = Number(header);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1000, BACKOFF_MAX_MS);
      }
      const date = Date.parse(header);
      if (!Number.isNaN(date)) {
        return Math.min(Math.max(date - now(), 0), BACKOFF_MAX_MS);
      }
    }
    return backoffMs(attempt);
  }

  /** One request to the resolved URL, without retries. Never throws. */
  async function attemptOnce(
    target: string,
    signal: AbortSignal | undefined,
    spec: RequestSpec,
  ): Promise<RawAttempt> {
    if (signal?.aborted) {
      return { kind: "failed", code: "aborted" };
    }
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const failed = (): RawAttempt => {
      if (signal?.aborted) {
        return { kind: "failed", code: "aborted" };
      }
      return timeoutSignal.aborted
        ? { kind: "failed", code: "timeout" }
        : { kind: "failed", code: "network" };
    };

    let response: Response;
    try {
      response = await fetchImpl(target, {
        method: spec.method,
        headers: { "user-agent": JOB_FINDER_USER_AGENT, accept: ACCEPT, ...spec.headers },
        body: spec.body,
        redirect: "follow",
        signal: requestSignal,
      });
    } catch {
      return failed();
    }
    const base = {
      kind: "response" as const,
      status: response.status,
      finalUrl: response.url || target,
      contentType: response.headers.get("content-type") ?? "",
      retryAfter: response.headers.get("retry-after"),
    };
    if (base.status < 200 || base.status > 299) {
      await response.body?.cancel();
      return base;
    }
    try {
      return { ...base, body: await readBody(response, maxBodyBytes) };
    } catch {
      return failed();
    }
  }

  /** Fetches one robots.txt. A failure is answered with a rule set, never thrown. */
  async function fetchRobots(origin: string): Promise<RobotsEntry> {
    const robotsUrl = `${origin}/robots.txt`;
    const blockAll: RobotsRules = () => false;
    const allowAll: RobotsRules = () => true;
    try {
      const response = await queueFor(new URL(robotsUrl).host).add(() =>
        fetchImpl(robotsUrl, {
          headers: { "user-agent": JOB_FINDER_USER_AGENT, accept: "text/plain,*/*;q=0.8" },
          redirect: "follow",
          signal: AbortSignal.timeout(timeoutMs),
        }),
      );
      const status = response.status;
      if (status >= 200 && status < 300) {
        const body = await readBody(response, maxBodyBytes);
        if (body === undefined) {
          return { expiresAt: now() + robotsFailureTtlMs, allows: blockAll };
        }
        const parsed = robotsParser(robotsUrl, body);
        return {
          expiresAt: now() + robotsTtlMs,
          allows: (url) => parsed.isAllowed(url, ROBOTS_PRODUCT_TOKEN) !== false,
        };
      }
      await response.body?.cancel();
      if (status === 401 || status === 403) {
        return { expiresAt: now() + robotsTtlMs, allows: blockAll };
      }
      if (status >= 500) {
        return { expiresAt: now() + robotsFailureTtlMs, allows: blockAll };
      }
      // 404, 410 and other 4xx mean "no robots.txt": everything is allowed (RFC 9309).
      return { expiresAt: now() + robotsTtlMs, allows: allowAll };
    } catch {
      return { expiresAt: now() + robotsFailureTtlMs, allows: blockAll };
    }
  }

  async function robotsAllow(absoluteUrl: string): Promise<boolean> {
    const origin = new URL(absoluteUrl).origin;
    let entry = robots.get(origin);
    if (!entry || entry.expiresAt <= now()) {
      let pending = robotsPending.get(origin);
      if (!pending) {
        pending = fetchRobots(origin).finally(() => robotsPending.delete(origin));
        robotsPending.set(origin, pending);
      }
      entry = await pending;
      robots.set(origin, entry);
    }
    return entry.allows(absoluteUrl);
  }

  const client: HttpClient = {
    resolve(url) {
      return resolveRequestUrl(url, options.fixtureBaseUrl);
    },
    async isAllowed(url) {
      const target = resolveRequestUrl(url, options.fixtureBaseUrl);
      if (target === undefined) {
        return false;
      }
      return robotsAllow(target);
    },
    async get(url, requestOptions = {}): Promise<HttpResult> {
      const headers = requestOptions.headers ?? {};
      const cacheable = Object.keys(headers).length === 0;
      return send(url, { method: "GET", headers }, requestOptions.signal, cacheable);
    },
    async post(url, postOptions): Promise<HttpResult> {
      const { body, headers = {}, signal } = postOptions;
      return send(url, { method: "POST", headers, body }, signal, false);
    },
  };

  async function send(
    url: string,
    spec: RequestSpec,
    signal: AbortSignal | undefined,
    cacheable: boolean,
  ): Promise<HttpResult> {
    const target = resolveRequestUrl(url, options.fixtureBaseUrl);
    if (target === undefined) {
      return { ok: false, code: "invalid-url", url };
    }
    if (cacheable) {
      const cached = cacheGet(target);
      if (cached) {
        return { ok: true, url: target, cached: true, ...cached };
      }
    }
    if (!(await robotsAllow(target))) {
      return { ok: false, code: "blocked-by-robots", url: target };
    }
    const queue = queueFor(new URL(target).host);
    for (let attempt = 1; ; attempt += 1) {
      if (signal?.aborted) {
        return { ok: false, code: "aborted", url: target };
      }
      const attempted = (): Promise<RawAttempt> => attemptOnce(target, signal, spec);
      const raw: RawAttempt = await queue.add(attempted);
      if (raw.kind === "failed") {
        if (raw.code === "network" && attempt < maxAttempts) {
          await sleep(backoffMs(attempt));
          continue;
        }
        return { ok: false, code: raw.code, url: target };
      }

      // A redirect may leave the origin robots.txt was read for: check the final URL too.
      if (raw.finalUrl !== target && !(await robotsAllow(raw.finalUrl))) {
        return { ok: false, code: "blocked-by-robots", url: raw.finalUrl };
      }

      const retryable = raw.status === 429 || raw.status >= 500;
      if (retryable && attempt < maxAttempts) {
        await sleep(retryDelayMs(raw.retryAfter, attempt));
        continue;
      }
      if (raw.status < 200 || raw.status > 299) {
        return { ok: false, code: "http-status", url: target, status: raw.status };
      }
      if (raw.body === undefined) {
        return { ok: false, code: "too-large", url: target, status: raw.status };
      }
      const value = { status: raw.status, contentType: raw.contentType, body: raw.body };
      if (cacheable) {
        cachePut(target, value);
      }
      return { ok: true, url: target, cached: false, ...value };
    }
  }
  return client;
}
