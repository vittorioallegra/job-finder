// protects=the hidden loader window is sandboxed without a preload in an in-memory partition, denies every permission, blocks downloads and window.open, refuses non-web subresources, and cancels navigation that leaves the requested origin;
// fails_when=a permission is granted, a download proceeds, a popup opens, a local file subresource loads, a cross-origin navigation or redirect is allowed, or the window gets a preload or a persistent partition;
// no_claim=Electron's own enforcement of these flags is trusted, not re-tested; the real window is covered only by the desktop E2E run.
import type { BrowserWindow } from "electron";
import { describe, expect, it, vi } from "vitest";
import { hardenPageWindow, PAGE_LOADER_PARTITION, pageWindowOptions } from "./hardening";

type Listener = (...args: unknown[]) => unknown;

function fakeWindow() {
  const sessionListeners = new Map<string, Listener[]>();
  const contentsListeners = new Map<string, Listener[]>();
  const handlers: Record<string, Listener> = {};
  const addTo = (map: Map<string, Listener[]>, event: string, listener: Listener) => {
    map.set(event, [...(map.get(event) ?? []), listener]);
  };
  const session = {
    setPermissionRequestHandler: (handler: Listener) => (handlers["permissionRequest"] = handler),
    setPermissionCheckHandler: (handler: Listener) => (handlers["permissionCheck"] = handler),
    setDevicePermissionHandler: (handler: Listener) => (handlers["devicePermission"] = handler),
    on: (event: string, listener: Listener) => addTo(sessionListeners, event, listener),
    webRequest: {
      onBeforeRequest: (listener: Listener) => (handlers["beforeRequest"] = listener),
    },
  };
  const webContents = {
    session,
    setWindowOpenHandler: (handler: Listener) => (handlers["windowOpen"] = handler),
    on: (event: string, listener: Listener) => addTo(contentsListeners, event, listener),
  };
  const window = { webContents } as unknown as BrowserWindow;
  const emit = (map: Map<string, Listener[]>, event: string, ...args: unknown[]) =>
    (map.get(event) ?? []).forEach((listener) => listener(...args));
  return {
    window,
    handlers,
    emitSession: (event: string, ...args: unknown[]) => emit(sessionListeners, event, ...args),
    emitContents: (event: string, ...args: unknown[]) => emit(contentsListeners, event, ...args),
  };
}

function navigationEvent(url: string) {
  return { url, preventDefault: vi.fn() };
}

describe("hidden page loader window", () => {
  it("is sandboxed, has no preload, is never shown and uses an in-memory partition", () => {
    const options = pageWindowOptions();
    expect(options.show).toBe(false);
    expect(options.webPreferences).toMatchObject({
      partition: expect.stringContaining(PAGE_LOADER_PARTITION),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: false,
      webviewTag: false,
    });
    expect(options.webPreferences?.preload).toBeUndefined();
    expect(PAGE_LOADER_PARTITION.startsWith("persist:")).toBe(false);
    // One partition per window: concurrent renders never share session handlers or storage.
    expect(pageWindowOptions().webPreferences?.partition).not.toBe(
      pageWindowOptions().webPreferences?.partition,
    );
  });

  it("denies every permission request, check and device permission", () => {
    const fake = fakeWindow();
    hardenPageWindow(fake.window, "https://jobs.example.test");
    const callback = vi.fn();

    fake.handlers["permissionRequest"]?.({}, "notifications", callback);

    expect(callback).toHaveBeenCalledWith(false);
    expect(fake.handlers["permissionCheck"]?.()).toBe(false);
    expect(fake.handlers["devicePermission"]?.()).toBe(false);
  });

  it("prevents every download and denies window.open", () => {
    const fake = fakeWindow();
    hardenPageWindow(fake.window, "https://jobs.example.test");
    const download = { preventDefault: vi.fn() };

    fake.emitSession("will-download", download);

    expect(download.preventDefault).toHaveBeenCalled();
    expect(fake.handlers["windowOpen"]?.()).toEqual({ action: "deny" });
  });

  it("cancels subresources that are not web or data URLs", () => {
    const fake = fakeWindow();
    hardenPageWindow(fake.window, "https://jobs.example.test");
    const decide = (url: string) => {
      const callback = vi.fn();
      fake.handlers["beforeRequest"]?.({ url }, callback);
      return callback.mock.calls[0]?.[0];
    };

    expect(decide("https://cdn.example.test/app.js")).toEqual({ cancel: false });
    expect(decide("file:///etc/passwd")).toEqual({ cancel: true });
  });

  it("cancels top-frame, redirect and subframe navigation that leaves the origin", () => {
    const fake = fakeWindow();
    hardenPageWindow(fake.window, "https://jobs.example.test");

    for (const event of ["will-navigate", "will-redirect", "will-frame-navigate"]) {
      const leaving = navigationEvent("https://elsewhere.example.test/x");
      const staying = navigationEvent("https://jobs.example.test/next");
      fake.emitContents(event, leaving);
      fake.emitContents(event, staying);
      expect(leaving.preventDefault, event).toHaveBeenCalled();
      expect(staying.preventDefault, event).not.toHaveBeenCalled();
    }
  });
});
