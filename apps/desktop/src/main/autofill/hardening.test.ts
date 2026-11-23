// protects=the form window is sandboxed, has no preload, uses an in-memory partition of its own, denies every permission and popup, limits subresources and navigation to web addresses, and lets a download through only right after the user's own key or click;
// fails_when=the window gets a preload or a persistent partition, a permission is granted, a popup opens, a file or script-URL navigation proceeds, or a download starts with no user input behind it;
// no_claim=the form's own scripts and the save dialog are not exercised here; the Electron end-to-end test loads a fixture form through this window;
import { describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import {
  applyPartition,
  applyWindowOptions,
  hardenApplyWindow,
  USER_INPUT_WINDOW_MS,
} from "./hardening";

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

describe("form window", () => {
  it("is sandboxed, has no preload, is shown, and uses a fresh in-memory partition", () => {
    const options = applyWindowOptions(applyPartition());
    expect(options.show).toBe(true);
    expect(options.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: false,
    });
    expect(options.webPreferences?.preload).toBeUndefined();

    const first = applyPartition();
    expect(first.startsWith("persist:")).toBe(false);
    expect(first).not.toBe(applyPartition());
  });

  it("denies every permission, check and device permission", () => {
    const fake = fakeWindow();
    const callback = vi.fn();
    hardenApplyWindow(fake.window);

    fake.handlers["permissionRequest"]?.({}, "geolocation", callback);

    expect(callback).toHaveBeenCalledWith(false);
    expect(fake.handlers["permissionCheck"]?.()).toBe(false);
    expect(fake.handlers["devicePermission"]?.()).toBe(false);
  });

  it("denies popups and limits subresources to web and data addresses", () => {
    const fake = fakeWindow();
    hardenApplyWindow(fake.window);
    const decide = (url: string) => {
      const callback = vi.fn();
      fake.handlers["beforeRequest"]?.({ url }, callback);
      return callback.mock.calls[0]?.[0] as { cancel: boolean };
    };

    expect(fake.handlers["windowOpen"]?.()).toEqual({ action: "deny" });
    expect(decide("https://boards.greenhouse.io/app.js")).toEqual({ cancel: false });
    expect(decide("file:///etc/passwd")).toEqual({ cancel: true });
  });

  it("refuses navigation to anything but a web address", () => {
    const fake = fakeWindow();
    hardenApplyWindow(fake.window);
    const navigation = (url: string) => {
      const event = { url, preventDefault: vi.fn() };
      fake.emitContents("will-navigate", event);
      return event.preventDefault.mock.calls.length > 0;
    };

    expect(navigation("https://jobs.lever.co/acme/1/apply")).toBe(false);
    expect(navigation("file:///Users/someone/secret.txt")).toBe(true);
    expect(navigation("javascript:alert(1)")).toBe(true);
  });

  it("blocks a download unless the user pressed a key or clicked just before it", () => {
    let clock = 1_000_000;
    const fake = fakeWindow();
    hardenApplyWindow(fake.window, () => clock);
    const download = () => {
      const event = { preventDefault: vi.fn() };
      fake.emitSession("will-download", event);
      return event.preventDefault.mock.calls.length > 0;
    };

    expect(download()).toBe(true);

    fake.emitContents("before-input-event", {}, { type: "mouseDown" });
    clock += USER_INPUT_WINDOW_MS - 1;
    expect(download()).toBe(false);

    clock += 2;
    expect(download()).toBe(true);
  });
});
