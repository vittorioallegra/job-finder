import { BrowserWindow, session } from "electron";
import type { ApplyWindow } from "./service";
import { applyPartition, applyWindowOptions, hardenApplyWindow } from "./hardening";

/**
 * Opens the visible form window for one application, in its own in-memory session. Only main
 * creates these; the page has no channel back to the app.
 */
export function openApplyWindow(): ApplyWindow {
  const partition = applyPartition();
  const window = new BrowserWindow(applyWindowOptions(partition));
  hardenApplyWindow(window);
  const { webContents } = window;
  // Whoever closes the window, its cookies and storage go with it.
  window.once("closed", () => {
    void session
      .fromPartition(partition)
      .clearStorageData()
      .catch(() => {});
  });

  return {
    debuggerApi: webContents.debugger,
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
            reject(new Error("load-failed"));
          }
        };
        const onGone = (): void => {
          cleanup();
          reject(new Error("load-failed"));
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
    onClosed(listener) {
      window.once("closed", listener);
    },
    close() {
      if (!window.isDestroyed()) {
        window.close();
      }
    },
  };
}
