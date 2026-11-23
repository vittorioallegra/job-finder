import mammoth from "mammoth";
import { extractText as extractPdfText } from "unpdf";

/** Largest CV file accepted, in bytes. */
export const CV_MAX_BYTES = 10 * 1024 * 1024;
/** Largest extracted text sent to the AI, in characters. */
export const CV_MAX_TEXT_CHARS = 200_000;

export const CV_DOCUMENT_ERROR_CODES = [
  "unsupported-type",
  "too-large",
  "unreadable",
  "empty-document",
] as const;
export type CvDocumentErrorCode = (typeof CV_DOCUMENT_ERROR_CODES)[number];

/** A CV file that cannot be turned into text. The code says why; the message never includes the text. */
export class CvDocumentError extends Error {
  readonly code: CvDocumentErrorCode;

  constructor(code: CvDocumentErrorCode, message: string) {
    super(message);
    this.name = "CvDocumentError";
    this.code = code;
  }
}

/** Picks the reader from the file extension. Returns null for types the app does not read. */
export function cvKindOf(fileName: string): "pdf" | "docx" | "txt" | null {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  if (extension === "pdf" || extension === "docx" || extension === "txt") {
    return extension;
  }
  return null;
}

async function readPdf(bytes: Uint8Array): Promise<string> {
  const { text } = await extractPdfText(bytes, { mergePages: true });
  return text;
}

async function readDocx(bytes: Uint8Array): Promise<string> {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

function readText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Extracts the plain text of a PDF, DOCX or plain-text CV. Checks the type and size first, then
 * the text length and emptiness. Throws `CvDocumentError` with a code for every refusal.
 */
export async function extractCvText(bytes: Uint8Array, fileName: string): Promise<string> {
  const kind = cvKindOf(fileName);
  if (kind === null) {
    throw new CvDocumentError(
      "unsupported-type",
      "Only PDF, DOCX and plain text CVs are supported",
    );
  }
  if (bytes.byteLength > CV_MAX_BYTES) {
    throw new CvDocumentError("too-large", "The CV file is larger than 10 MB");
  }

  let text: string;
  try {
    text =
      kind === "pdf"
        ? await readPdf(bytes)
        : kind === "docx"
          ? await readDocx(bytes)
          : readText(bytes);
  } catch {
    throw new CvDocumentError("unreadable", "The CV file could not be read");
  }

  const trimmed = text.trim();
  if (trimmed === "") {
    throw new CvDocumentError("empty-document", "The CV contains no text");
  }
  if (trimmed.length > CV_MAX_TEXT_CHARS) {
    throw new CvDocumentError("too-large", "The CV has more text than the AI can read at once");
  }
  return trimmed;
}
