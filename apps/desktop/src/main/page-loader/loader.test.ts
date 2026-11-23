// protects=the hidden loader returns a page's rendered HTML, rejects invalid URLs before opening a window, reports load failures, timeouts, oversize pages and any final URL outside the origin as codes, and always destroys its window;
// fails_when=an invalid URL opens a window, a timeout hangs instead of returning, an oversize page is returned, a window is left open after a failure, or a raw exception escapes as something other than unknown;
// no_claim=the Electron window, its events and executeJavaScript are not exercised here; the hardening test and the desktop E2E run cover the real window.
import { describe, expect, it, vi, type Mock } from "vitest";
import { createPageLoader, PageLoadError, type PageWindow } from "./loader";

type Fake = Omit<PageWindow, "dispose"> & { dispose: Mock<() => void> };

function fakePage(overrides: Partial<PageWindow> = {}): Fake {
  const page: Fake = {
    load: vi.fn(async () => {}),
    currentUrl: vi.fn(() => "https://jobs.example.test/careers"),
    readHtml: vi.fn(async () => "<main>rendered jobs</main>"),
    dispose: vi.fn<() => void>(),
  };
  return { ...page, ...overrides } as Fake;
}

const noSleep = async () => {};

describe("hidden page loader", () => {
  it("returns the rendered HTML and the final URL, then destroys the window", async () => {
    const page = fakePage();
    const openWindow = vi.fn(() => page);
    const loader = createPageLoader({ openWindow, sleep: noSleep, settleMs: 0 });

    const result = await loader.render("https://jobs.example.test/careers");

    expect(result).toEqual({
      ok: true,
      url: "https://jobs.example.test/careers",
      html: "<main>rendered jobs</main>",
    });
    expect(openWindow).toHaveBeenCalledWith("https://jobs.example.test");
    expect(page.dispose).toHaveBeenCalledTimes(1);
  });

  it("refuses a non-http URL before opening any window", async () => {
    const openWindow = vi.fn(() => fakePage());
    const loader = createPageLoader({ openWindow, sleep: noSleep });

    expect(await loader.render("file:///etc/hosts")).toEqual({ ok: false, code: "invalid-url" });
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("reports a load failure and still destroys the window", async () => {
    const page = fakePage({
      load: vi.fn(async () => {
        throw new PageLoadError("load-failed");
      }),
    });
    const loader = createPageLoader({ openWindow: () => page, sleep: noSleep });

    expect(await loader.render("https://jobs.example.test/down")).toEqual({
      ok: false,
      code: "load-failed",
    });
    expect(page.dispose).toHaveBeenCalledTimes(1);
  });

  it("gives up on a page that never finishes loading", async () => {
    const page = fakePage({ load: () => new Promise<void>(() => {}) });
    const loader = createPageLoader({ openWindow: () => page, timeoutMs: 5, sleep: noSleep });

    expect(await loader.render("https://jobs.example.test/hang")).toEqual({
      ok: false,
      code: "timeout",
    });
    expect(page.dispose).toHaveBeenCalledTimes(1);
  });

  it("reports a page over the size limit as too-large", async () => {
    const page = fakePage({ readHtml: async () => "x".repeat(100) });
    const loader = createPageLoader({
      openWindow: () => page,
      sleep: noSleep,
      maxHtmlBytes: 10,
    });

    expect(await loader.render("https://jobs.example.test/big")).toEqual({
      ok: false,
      code: "too-large",
    });
  });

  it("refuses a final URL that left the requested origin", async () => {
    const page = fakePage({ currentUrl: () => "https://elsewhere.example.test/landing" });
    const loader = createPageLoader({ openWindow: () => page, sleep: noSleep });

    expect(await loader.render("https://jobs.example.test/redirect")).toEqual({
      ok: false,
      code: "load-failed",
    });
    expect(page.dispose).toHaveBeenCalledTimes(1);
  });

  it("waits the settle delay after the load before reading the page", async () => {
    const sleep = vi.fn(async () => {});
    const page = fakePage();
    const loader = createPageLoader({ openWindow: () => page, sleep, settleMs: 750 });

    await loader.render("https://jobs.example.test/js");

    expect(sleep).toHaveBeenCalledWith(750);
  });

  it("reports any other error as unknown rather than leaking its text", async () => {
    const page = fakePage({
      readHtml: async () => {
        throw new Error("renderer crashed with secret detail");
      },
    });
    const loader = createPageLoader({ openWindow: () => page, sleep: noSleep });

    expect(await loader.render("https://jobs.example.test/boom")).toEqual({
      ok: false,
      code: "unknown",
    });
  });
});
