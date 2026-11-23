import { randomUUID } from "node:crypto";
import type { BrowserWindowConstructorOptions } from "electron";

/**
 * A partition without the `persist:` prefix is in memory: nothing a PDF render leaves behind
 * reaches the app's own session.
 */
export const PDF_PARTITION = "job-finder-pdf";

/** A fresh in-memory partition per render, so concurrent exports never share handlers or storage. */
export function pdfPartition(): string {
  return `${PDF_PARTITION}-${randomUUID()}`;
}

/**
 * Options of the hidden window that prints a document. No preload, no JavaScript (the document is
 * static HTML), sandboxed, never shown. Types only: this file loads in tests without Electron.
 */
export function pdfWindowOptions(
  partition: string = pdfPartition(),
): BrowserWindowConstructorOptions {
  return {
    show: false,
    width: 794,
    height: 1123,
    webPreferences: {
      partition,
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
