/** A hidden window that can load one document and print it. Implemented over Electron in `pdf-window.ts`. */
export interface PdfWindow {
  loadHtml(html: string): Promise<void>;
  printPdf(): Promise<Uint8Array>;
  dispose(): void;
}

export interface PdfRendererOptions {
  openWindow(): PdfWindow;
}

/**
 * Renders an HTML document to PDF bytes in a fresh window that is always disposed. A failed load
 * rejects; the window is closed either way.
 */
export function createPdfRenderer(
  options: PdfRendererOptions,
): (html: string) => Promise<Uint8Array> {
  return async (html) => {
    const pdfWindow = options.openWindow();
    try {
      await pdfWindow.loadHtml(html);
      return await pdfWindow.printPdf();
    } finally {
      pdfWindow.dispose();
    }
  };
}
