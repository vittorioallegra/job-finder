import {
  documentLanguageFor,
  type ApplicationDocuments,
  type DocumentLanguage,
  type DocumentLanguageChoice,
  type DocumentExportRequest,
  type DocumentExportResult,
  type DocumentGenerateRequest,
  type DocumentGenerateResult,
  type DocumentSaveRequest,
  type DocumentSetLanguageRequest,
  type DocumentSaveResult,
} from "@job-finder/bridge";
import { renderDocumentHtml, type DocumentLabels } from "@job-finder/core/documents/render";
import { validateDocument } from "@job-finder/core/documents/schema";
import type { GenerateDocumentRequest } from "../../engine/protocol";
import type { GenerateDocumentOutcome } from "@job-finder/core/documents/generate";
import type { ExplanationLanguage } from "@job-finder/core/ranking";
import { createTranslator, type MainLanguage } from "../i18n";
import { EngineUnavailableError } from "../engine/supervisor";
import type { ProfileRepository } from "../profile/repository";
import type { SecretStore } from "../secrets/store";
import type { SettingsRepository } from "../settings/repository";
import { explanationLanguage } from "../scoring/service";
import type { DocumentRepository } from "./repository";
import { readAiKey } from "../ai/keys";

/** The engine side of document generation, as seen from main. */
export interface DocumentEngine {
  generateDocument(request: GenerateDocumentRequest): Promise<GenerateDocumentOutcome>;
}

export interface DocumentService {
  /** The stored CV and cover letter of an application. */
  get(applicationId: string): Promise<ApplicationDocuments>;
  /** Generates a document with the AI and stores it, replacing the draft of that kind. */
  generate(request: DocumentGenerateRequest): Promise<DocumentGenerateResult>;
  /** Saves the language the user chose for the application's documents. False when it does not exist. */
  setLanguage(request: DocumentSetLanguageRequest): Promise<boolean>;
  /** Stores the user's edits after the profile checks. */
  save(request: DocumentSaveRequest): Promise<DocumentSaveResult>;
  /** Renders the stored document to a PDF in the application's folder. */
  exportPdf(request: DocumentExportRequest): Promise<DocumentExportResult>;
  /** Shows the exported PDF in the file manager. False when there is none. */
  reveal(request: DocumentExportRequest): Promise<boolean>;
}

export interface DocumentServiceOptions {
  repository: DocumentRepository;
  profile: Pick<ProfileRepository, "get">;
  settings: Pick<SettingsRepository, "get">;
  secrets: Pick<SecretStore, "read">;
  engine: DocumentEngine;
  /** Renders one HTML document to PDF bytes (a hidden window in the app). */
  renderPdf(html: string): Promise<Uint8Array>;
  /** Writes an exported PDF to the application's folder. */
  writePdf(
    applicationId: string,
    kind: DocumentExportRequest["kind"],
    bytes: Uint8Array,
  ): Promise<void>;
  /** Where the PDF of a document is stored, for reveal. */
  pdfPath(applicationId: string, kind: DocumentExportRequest["kind"]): string;
  /** Opens the file manager at a path. */
  revealPath(path: string): void;
  /** The OS locale, used when the UI language setting is "system". */
  systemLocale(): string;
  now?: () => number;
}

/** Labels of the rendered documents in one language: the main i18n keys under `documents.labels`. */
export function documentLabels(language: MainLanguage): DocumentLabels {
  const t = createTranslator(language);
  return {
    cvTitle: t("documents.labels.cvTitle"),
    coverLetterTitle: t("documents.labels.coverLetterTitle"),
    summary: t("documents.labels.summary"),
    experience: t("documents.labels.experience"),
    education: t("documents.labels.education"),
    skills: t("documents.labels.skills"),
    greeting: t("documents.labels.greeting"),
    present: t("documents.labels.present"),
  };
}

/**
 * Main-process side of the documents. Generation checks the profile, reads the AI settings and the
 * key, and hands the call to the engine; the answer is stored here. Saved edits and exports are checked
 * against the profile before they are stored or rendered.
 */
export function createDocumentService(options: DocumentServiceOptions): DocumentService {
  const now = options.now ?? (() => Date.now());
  const repository = options.repository;

  async function uiLanguage(): Promise<ExplanationLanguage> {
    const { ui } = await options.settings.get();
    return explanationLanguage(ui.language, options.systemLocale());
  }

  /** The user's choice for the application, else the posting's language, else the UI's. */
  async function languageFor(
    applicationId: string,
    postingLanguage: string | null | undefined,
  ): Promise<DocumentLanguageChoice> {
    const chosen = await repository.chosenLanguage(applicationId);
    if (chosen !== null) return { language: chosen, source: "chosen" };
    return documentLanguageFor(postingLanguage, await uiLanguage());
  }

  return {
    async setLanguage(request) {
      return repository.setChosenLanguage(request.applicationId, request.language);
    },

    async get(applicationId) {
      const stored = await repository.forApplication(applicationId);
      const posting = await repository.jobOf(applicationId);
      return {
        ...stored,
        defaultLanguage: await languageFor(applicationId, posting?.language),
      };
    },

    async generate(request) {
      const posting = await repository.jobOf(request.applicationId);
      if (posting === null) return { ok: false, code: "not-found" };
      const { language: postingLanguage, ...job } = posting;
      const saved = await options.profile.get();
      if (saved === null) return { ok: false, code: "no-profile" };
      const { ai } = await options.settings.get();
      const language: DocumentLanguage =
        request.language ?? (await languageFor(request.applicationId, postingLanguage)).language;
      const apiKey = await readAiKey(options.secrets, ai);
      let outcome: GenerateDocumentOutcome;
      try {
        outcome = await options.engine.generateDocument({
          kind: request.kind,
          profile: saved.profile,
          job,
          language,
          ai: {
            config: {
              provider: ai.provider,
              model: ai.model,
              baseUrl: ai.baseUrl,
              apiKey,
            },
            contextSize: ai.contextSize,
          },
        });
      } catch (error) {
        if (error instanceof EngineUnavailableError) {
          return { ok: false, code: "engine-unavailable" };
        }
        return { ok: false, code: "unknown" };
      }
      if (!outcome.ok) {
        return { ok: false, code: outcome.code };
      }
      const document = await repository.save(
        request.applicationId,
        request.kind,
        outcome.content,
        language,
        now(),
      );
      return { ok: true, document };
    },

    async save(request) {
      const existing = await repository.find(request.applicationId, request.content.kind);
      if (existing === null) return { ok: false, code: "not-found" };
      const saved = await options.profile.get();
      if (saved === null) return { ok: false, code: "no-profile" };
      const issues = validateDocument(request.content, saved.profile);
      if (issues.length > 0) {
        return { ok: false, code: "validation-failed", issues };
      }
      // An edit keeps the language the document was written in.
      const language = existing.language ?? (await uiLanguage());
      const document = await repository.save(
        request.applicationId,
        request.content.kind,
        request.content,
        language,
        now(),
      );
      return { ok: true, document };
    },

    async exportPdf(request) {
      const stored = await repository.find(request.applicationId, request.kind);
      if (stored === null) return { ok: false, code: "not-found" };
      const saved = await options.profile.get();
      if (saved === null) return { ok: false, code: "no-profile" };
      // The PDF follows the document's own language; a document stored before languages were kept
      // uses the UI language it was generated in.
      const language = stored.language ?? (await uiLanguage());
      const html = renderDocumentHtml(
        stored.content,
        saved.profile.contact,
        documentLabels(language),
        language,
      );
      try {
        const bytes = await options.renderPdf(html);
        await options.writePdf(request.applicationId, request.kind, bytes);
        const document = await repository.markExported(request.applicationId, request.kind, now());
        if (document === null) return { ok: false, code: "not-found" };
        return { ok: true, document };
      } catch {
        return { ok: false, code: "export-failed" };
      }
    },

    async reveal(request) {
      const stored = await repository.find(request.applicationId, request.kind);
      if (stored === null || stored.exportedAt === null) return false;
      options.revealPath(options.pdfPath(request.applicationId, request.kind));
      return true;
    },
  };
}
