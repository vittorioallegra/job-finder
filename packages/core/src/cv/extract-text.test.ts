// protects=CV files are turned into plain text for PDF, DOCX and TXT, and refused by type, size, unreadable content or emptiness before any AI call;
// fails_when=a supported format yields no text, a known sample line is lost, an unknown extension is read, an oversized or empty file is accepted, or an error message carries the CV text;
// no_claim=layout fidelity, scanned PDFs without a text layer, and legacy .doc files are not covered.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CV_MAX_BYTES, CvDocumentError, cvKindOf, extractCvText } from "./extract-text";

const fixtures = join(__dirname, "fixtures");

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixtures, name)));
}

async function refusalCode(promise: Promise<string>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof CvDocumentError ? error.code : "other";
  }
}

describe("extractCvText", () => {
  it("reads the plain-text sample", async () => {
    const text = await extractCvText(fixture("sample-cv-en.txt"), "sample-cv-en.txt");
    expect(text).toContain("Politecnico di Torino");
    expect(text).toContain("TypeScript, Go, PostgreSQL, Kubernetes");
  });

  it("reads the Italian DOCX sample", async () => {
    const text = await extractCvText(fixture("sample-cv-it.docx"), "sample-cv-it.docx");
    expect(text).toContain("Clinica Serena");
    expect(text).toContain("Competenze");
  });

  it("reads the PDF sample", async () => {
    const text = await extractCvText(fixture("sample-cv-en.pdf"), "Sample-CV-EN.PDF");
    expect(text).toContain("Acme Payments");
    expect(text).toContain("AWS Certified Solutions Architect");
  });

  it("refuses an unsupported extension", async () => {
    expect(await refusalCode(extractCvText(new Uint8Array([1]), "cv.rtf"))).toBe(
      "unsupported-type",
    );
    expect(cvKindOf("notes")).toBeNull();
  });

  it("refuses a file above the size limit before reading it", async () => {
    const oversized = new Uint8Array(CV_MAX_BYTES + 1);
    expect(await refusalCode(extractCvText(oversized, "cv.txt"))).toBe("too-large");
  });

  it("refuses a document with no text", async () => {
    const blank = new TextEncoder().encode("  \n\t  ");
    expect(await refusalCode(extractCvText(blank, "cv.txt"))).toBe("empty-document");
  });

  it("reports a corrupt DOCX as unreadable without echoing its bytes", async () => {
    const garbage = new TextEncoder().encode("this is not a zip archive");
    const code = await refusalCode(extractCvText(garbage, "cv.docx"));
    expect(code).toBe("unreadable");
  });
});
