// protects=the PDF renderer loads one document, prints it and always closes its window, whether the load or the print fails, and its window options keep scripts, preloads and persistent storage off;
// fails_when=the window is left open after a failed load, a print runs on a window that did not load, the window is created with JavaScript or a preload, or its partition persists to disk;
// no_claim=the Chromium print output and the page layout are not checked here; only the window lifecycle and its hardening options are asserted;
import { describe, expect, it } from "vitest";
import { createPdfRenderer, type PdfWindow } from "./pdf";
import { pdfWindowOptions, PDF_PARTITION } from "./pdf-options";

function fakeWindow(failLoad: boolean) {
  const events: string[] = [];
  const window: PdfWindow = {
    loadHtml: async (html) => {
      events.push(`load:${html.length}`);
      if (failLoad) throw new Error("load failed");
    },
    printPdf: async () => {
      events.push("print");
      return new Uint8Array([37, 80, 68, 70]);
    },
    dispose: () => {
      events.push("dispose");
    },
  };
  return { window, events };
}

describe("createPdfRenderer", () => {
  it("loads, prints and disposes the window, in that order", async () => {
    const { window, events } = fakeWindow(false);
    const render = createPdfRenderer({ openWindow: () => window });

    const bytes = await render("<html></html>");

    expect(events).toEqual(["load:13", "print", "dispose"]);
    expect(Array.from(bytes)).toEqual([37, 80, 68, 70]);
  });

  it("disposes the window and rejects when the load fails, without printing", async () => {
    const { window, events } = fakeWindow(true);
    const render = createPdfRenderer({ openWindow: () => window });

    await expect(render("<html></html>")).rejects.toThrow("load failed");
    expect(events).toEqual(["load:13", "dispose"]);
  });
});

describe("pdfWindowOptions", () => {
  it("creates a hidden, sandboxed window with no preload, no JavaScript and an in-memory partition", () => {
    const options = pdfWindowOptions();
    const web = options.webPreferences ?? {};

    expect(options.show).toBe(false);
    expect(web.preload).toBeUndefined();
    expect(web.javascript).toBe(false);
    expect(web.sandbox).toBe(true);
    expect(web.contextIsolation).toBe(true);
    expect(web.nodeIntegration).toBe(false);
    expect(web.partition).toContain(PDF_PARTITION);
    expect(pdfWindowOptions().webPreferences?.partition).not.toBe(web.partition);
    expect(PDF_PARTITION.startsWith("persist:")).toBe(false);
  });
});
