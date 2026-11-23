import { BrowserWindow } from "electron";
import { PageLoadError, type PageWindow } from "./loader";
import { hardenPageWindow, pageWindowOptions } from "./hardening";

/** Opens a hidden, hardened window for one page load. Only main creates these. */
export function openPageWindow(origin: string): PageWindow {
  const window = new BrowserWindow(pageWindowOptions());
  hardenPageWindow(window, origin);
  const { webContents } = window;
  const ownSession = webContents.session;

  return {
    load(url) {
      return new Promise((resolve, reject) => {
        const onFinish = (): void => {
          cleanup();
          resolve();
        };
        const onFail = (
          _event: unknown,
          _code: number,
          _description: string,
          _url: string,
          isMainFrame: boolean,
        ): void => {
          if (isMainFrame) {
            cleanup();
            reject(new PageLoadError("load-failed"));
          }
        };
        const onGone = (): void => {
          cleanup();
          reject(new PageLoadError("load-failed"));
        };
        const cleanup = (): void => {
          webContents.off("did-finish-load", onFinish);
          webContents.off("did-fail-load", onFail);
          webContents.off("render-process-gone", onGone);
        };
        webContents.on("did-finish-load", onFinish);
        webContents.on("did-fail-load", onFail);
        webContents.on("render-process-gone", onGone);
        // Failures arrive as events; the loadURL promise is only a second signal, so its rejection is ignored.
        window.loadURL(url).catch(() => {});
      });
    },
    currentUrl() {
      return webContents.getURL();
    },
    readHtml() {
      return webContents.executeJavaScript(
        "document.documentElement.outerHTML",
        false,
      ) as Promise<string>;
    },
    dispose() {
      if (!window.isDestroyed()) {
        window.destroy();
      }
      void ownSession.clearStorageData().catch(() => {});
    },
  };
}
