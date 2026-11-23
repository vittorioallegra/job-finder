import { z } from "zod";
import {
  DOCUMENT_LANGUAGES,
  type DocumentLanguage,
  type DocumentLanguageChoice,
} from "@job-finder/core/documents/language";
import {
  DOCUMENT_KINDS,
  DocumentContentSchema,
  type DocumentContent,
  type DocumentIssue,
  type DocumentKind,
} from "@job-finder/core/documents/schema";

export {
  DOCUMENT_LANGUAGES,
  documentLanguageFor,
  type DocumentLanguage,
  type DocumentLanguageChoice,
} from "@job-finder/core/documents/language";
export {
  DOCUMENT_ISSUE_CODES,
  DOCUMENT_KINDS,
  DocumentContentSchema,
  type CoverLetter,
  type DocumentContent,
  type DocumentIssue,
  type DocumentIssueCode,
  type DocumentKind,
  type TailoredCv,
} from "@job-finder/core/documents/schema";

const identifier = z.string().min(1).max(64);

export const DocumentGetRequestSchema = z.strictObject({ applicationId: identifier });
export type DocumentGetRequest = z.input<typeof DocumentGetRequestSchema>;

/**
 * Generates a document with the AI. `consent` must be true when the AI provider is a cloud service,
 * because the profile and the posting are sent to it (the same rule as the CV import). `language`
 * overrides the language the posting and the UI would give; omitted, the default applies.
 */
export const DocumentGenerateRequestSchema = z.strictObject({
  applicationId: identifier,
  kind: z.enum(DOCUMENT_KINDS),
  consent: z.boolean(),
  language: z.enum(DOCUMENT_LANGUAGES).optional(),
});
export type DocumentGenerateRequest = z.input<typeof DocumentGenerateRequestSchema>;

/** Saves the user's edits. The content is checked against the profile again before it is stored. */
export const DocumentSaveRequestSchema = z.strictObject({
  applicationId: identifier,
  content: DocumentContentSchema,
});
export type DocumentSaveRequest = z.input<typeof DocumentSaveRequestSchema>;

export const DocumentExportRequestSchema = z.strictObject({
  applicationId: identifier,
  kind: z.enum(DOCUMENT_KINDS),
});
export type DocumentExportRequest = z.input<typeof DocumentExportRequestSchema>;

export const DocumentRevealRequestSchema = DocumentExportRequestSchema;
export type DocumentRevealRequest = DocumentExportRequest;

/**
 * One stored document. `updatedAt` and `exportedAt` are epoch milliseconds; `exportedAt` is null
 * before the first PDF. `language` is null for documents generated before languages were stored.
 */
export interface DocumentRecord {
  kind: DocumentKind;
  content: DocumentContent;
  language: DocumentLanguage | null;
  updatedAt: number;
  exportedAt: number | null;
}

export interface ApplicationDocuments {
  applicationId: string;
  cv: DocumentRecord | null;
  coverLetter: DocumentRecord | null;
  /** The language a new document of this application uses unless the user chooses another. */
  defaultLanguage: DocumentLanguageChoice;
}

/**
 * Why a document action failed. `consent-required` and `no-profile` come before any AI call;
 * `engine-unavailable` means the engine could not answer; the rest mirror the AI layer's error codes (must equal `AI_ERROR_CODES` in
 * packages/core/src/ai, checked by a desktop test).
 */
export const DOCUMENT_FAILURE_CODES = [
  "not-found",
  "no-profile",
  "consent-required",
  "engine-unavailable",
  "export-failed",
  "not-configured",
  "invalid-key",
  "model-not-found",
  "rate-limited",
  "unreachable",
  "invalid-output",
  "unknown",
] as const;
export type DocumentFailureCode = (typeof DOCUMENT_FAILURE_CODES)[number];

/** The codes that mean the AI cannot be used now: the screen offers the AI settings. */
export const DOCUMENT_AI_UNAVAILABLE_CODES: readonly DocumentFailureCode[] = [
  "not-configured",
  "invalid-key",
  "model-not-found",
  "rate-limited",
  "unreachable",
  "engine-unavailable",
];

export type DocumentGenerateResult =
  { ok: true; document: DocumentRecord } | { ok: false; code: DocumentFailureCode };

export type DocumentSaveResult =
  | { ok: true; document: DocumentRecord }
  | { ok: false; code: "not-found" | "no-profile" }
  | { ok: false; code: "validation-failed"; issues: DocumentIssue[] };

export type DocumentExportResult =
  | { ok: true; document: DocumentRecord }
  | { ok: false; code: "not-found" | "no-profile" | "export-failed" };
