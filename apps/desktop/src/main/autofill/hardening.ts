import { randomUUID } from "node:crypto";
import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron";
import { isAllowedSubresource } from "../page-loader/policy";

/** How long after a key press or mouse button a download still counts as the user's own. */
export const USER_INPUT_WINDOW_MS = 5_000;

/**
 * A fresh partition per form window, without the `persist:` prefix, so it is in memory: cookies
 * and storage never outlive the window and never mix with the app's own session.
 */
export function applyPartition(): string {
  return `job-finder-apply-${randomUUID()}`;
}

/** A visible window with no preload, sandboxed, JavaScript on (the form needs it), no devtools. */
export function applyWindowOptions(partition: string): BrowserWindowConstructorOptions {
  return {
    show: true,
    width: 1120,
    height: 860,
    webPreferences: {
      partition,
      javascript: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: false,
      webviewTag: false,
      plugins: false,
      safeDialogs: true,
      navigateOnDragDrop: false,
      spellcheck: false,
    },
  };
}

function isWebUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Applies the form window's rules: every permission denied, `window.open` denied, subresources
 * limited to web and data schemes, navigation (top frame, redirect or subframe) limited to web
 * addresses, and downloads blocked unless the user pressed a key or a mouse button in the window
 * just before (the save dialog then asks where the file goes). Returns the clock used for that rule.
 */
export function hardenApplyWindow(window: BrowserWindow, now: () => number = Date.now): void {
  const { webContents } = window;
  const session = webContents.session;
  let lastUserInput = Number.NEGATIVE_INFINITY;

  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
  session.on("will-download", (event) => {
    if (now() - lastUserInput > USER_INPUT_WINDOW_MS) {
      event.preventDefault();
    }
  });
  session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedSubresource(details.url) });
  });

  webContents.on("before-input-event", (_event, input) => {
    if (input.type === "keyDown" || input.type === "mouseDown") {
      lastUserInput = now();
    }
  });
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const refuseOtherSchemes = (event: { url: string; preventDefault(): void }): void => {
    if (!isWebUrl(event.url)) {
      event.preventDefault();
    }
  };
  webContents.on("will-navigate", refuseOtherSchemes);
  webContents.on("will-redirect", refuseOtherSchemes);
  webContents.on("will-frame-navigate", refuseOtherSchemes);
}
