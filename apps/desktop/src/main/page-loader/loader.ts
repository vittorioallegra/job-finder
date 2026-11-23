import type { PageRenderErrorCode, PageRenderResult } from "@job-finder/core/net";
import { isSameOrigin, parsePageUrl } from "./policy";

/** A load that failed for a reason the loader reports as a code. */
export class PageLoadError extends Error {
  readonly code: PageRenderErrorCode;

  constructor(code: PageRenderErrorCode) {
    super(`page load failed: ${code}`);
    this.name = "PageLoadError";
    this.code = code;
  }
}

/** One hidden window, as the loader uses it. The Electron implementation lives in `electron-window.ts`. */
export interface PageWindow {
  /** Resolves when the main frame has finished loading; rejects with a PageLoadError otherwise. */
  load(url: string): Promise<void>;
  currentUrl(): string;
  readHtml(): Promise<string>;
  /** Destroys the window and its session data. Never throws. */
  dispose(): void;
}

export interface PageLoaderOptions {
  openWindow(origin: string): PageWindow;
  timeoutMs?: number;
  /** Time given to scripts after the load event, so JavaScript-rendered content can appear. */
  settleMs?: number;
  maxHtmlBytes?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface PageLoader {
  /** Renders one page. Never throws: every failure is a code. */
  render(url: string): Promise<PageRenderResult>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SETTLE_MS = 1_000;
const DEFAULT_MAX_HTML_BYTES = 5 * 1024 * 1024;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PageLoadError("timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Hidden page loader: one window per request, destroyed afterwards. The window is opened by
 * `openWindow`, which applies the hardening rules; the loader adds the timeout, the settle delay
 * and the size limit, and turns every failure into a code.
 */
export function createPageLoader(options: PageLoaderOptions): PageLoader {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const maxHtmlBytes = options.maxHtmlBytes ?? DEFAULT_MAX_HTML_BYTES;
  const sleep = options.sleep ?? defaultSleep;

  return {
    async render(input) {
      const url = parsePageUrl(input);
      if (!url) {
        return { ok: false, code: "invalid-url" };
      }
      const origin = url.origin;
      let page: PageWindow | undefined;
      try {
        page = options.openWindow(origin);
        await withTimeout(page.load(url.href), timeoutMs);
        await sleep(settleMs);
        const finalUrl = page.currentUrl();
        if (!isSameOrigin(finalUrl, origin)) {
          return { ok: false, code: "load-failed" };
        }
        const html = await page.readHtml();
        if (Buffer.byteLength(html, "utf8") > maxHtmlBytes) {
          return { ok: false, code: "too-large" };
        }
        return { ok: true, url: finalUrl, html };
      } catch (error) {
        return { ok: false, code: error instanceof PageLoadError ? error.code : "unknown" };
      } finally {
        page?.dispose();
      }
    },
  };
}
