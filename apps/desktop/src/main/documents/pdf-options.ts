import type { BrowserWindowConstructorOptions } from "electron";

/**
 * A partition without the `persist:` prefix is in memory: nothing a PDF render leaves behind
 * reaches the app's own session.
 */
export const PDF_PARTITION = "job-finder-pdf";

/**
 * Options of the hidden window that prints a document. No preload, no JavaScript (the document is
 * static HTML), sandboxed, never shown. Types only: this file loads in tests without Electron.
 */
export function pdfWindowOptions(): BrowserWindowConstructorOptions {
  return {
    show: false,
    width: 794,
    height: 1123,
    webPreferences: {
      partition: PDF_PARTITION,
      javascript: false,
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
