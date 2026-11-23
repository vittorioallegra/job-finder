import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron";
import { isAllowedSubresource, isSameOrigin } from "./policy";

/**
 * A partition without the `persist:` prefix is in memory: cookies and storage vanish with the
 * window and never mix with the app's own session.
 */
export const PAGE_LOADER_PARTITION = "job-finder-page-loader";

/** Options for the hidden loader window. No preload, sandboxed, never shown, JavaScript on for rendering. */
export function pageWindowOptions(): BrowserWindowConstructorOptions {
  return {
    show: false,
    width: 1024,
    height: 768,
    webPreferences: {
      partition: PAGE_LOADER_PARTITION,
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

/**
 * Applies the loader's rules to a freshly created window: every permission denied, downloads
 * blocked, `window.open` denied, subresources limited to web and data schemes, and any navigation
 * (top frame, redirect or subframe) that leaves `origin` cancelled.
 */
export function hardenPageWindow(window: BrowserWindow, origin: string): void {
  const { webContents } = window;
  const session = webContents.session;

  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
  session.on("will-download", (event) => {
    event.preventDefault();
  });
  session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedSubresource(details.url) });
  });

  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const refuseOtherOrigins = (event: { url: string; preventDefault(): void }): void => {
    if (!isSameOrigin(event.url, origin)) {
      event.preventDefault();
    }
  };
  webContents.on("will-navigate", refuseOtherOrigins);
  webContents.on("will-redirect", refuseOtherOrigins);
  webContents.on("will-frame-navigate", refuseOtherOrigins);
}
