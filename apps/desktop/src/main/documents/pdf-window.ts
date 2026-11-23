import { BrowserWindow } from "electron";
import { pdfWindowOptions } from "./pdf-options";
import type { PdfWindow } from "./pdf";

/**
 * Opens a hidden, hardened window that prints one HTML document with the Electron Chromium (no
 * separate browser). Permissions and downloads are denied, the window may load only its own
 * `data:` document, and nothing is fetched from the network.
 */
export function openPdfWindow(): PdfWindow {
  const window = new BrowserWindow(pdfWindowOptions());
  const { webContents } = window;
  const pdfSession = webContents.session;

  pdfSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  pdfSession.setPermissionCheckHandler(() => false);
  pdfSession.setDevicePermissionHandler(() => false);
  pdfSession.on("will-download", (event) => {
    event.preventDefault();
  });
  pdfSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith("data:") });
  });
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  webContents.on("will-navigate", (event) => {
    if (!event.url.startsWith("data:")) event.preventDefault();
  });

  return {
    loadHtml(html) {
      return new Promise((resolve, reject) => {
        const cleanup = (): void => {
          webContents.off("did-finish-load", onFinish);
          webContents.off("did-fail-load", onFail);
          webContents.off("render-process-gone", onFail);
        };
        const onFinish = (): void => {
          cleanup();
          resolve();
        };
        const onFail = (): void => {
          cleanup();
          reject(new Error("the document could not be loaded"));
        };
        webContents.on("did-finish-load", onFinish);
        webContents.on("did-fail-load", onFail);
        webContents.on("render-process-gone", onFail);
        window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {});
      });
    },
    async printPdf() {
      const buffer = await webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
      });
      return new Uint8Array(buffer);
    },
    dispose() {
      if (!window.isDestroyed()) {
        window.destroy();
      }
      void pdfSession.clearStorageData().catch(() => {});
    },
  };
}
