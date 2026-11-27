import {
  documentLanguageFor,
  type ApplicationDocuments,
  type DocumentLanguage,
  type DocumentLanguageChoice,
  type DocumentExportRequest,
  type DocumentExportResult,
  type DocumentGenerateRequest,
  type DocumentGenerateResult,
  type DocumentPreviewResult,
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
  /**
   * Saves the language the user chose for the application's documents, and removes the documents
   * written in another language. False when the application does not exist.
   */
  setLanguage(request: DocumentSetLanguageRequest): Promise<boolean>;
  /** Stores the user's edits after the profile checks. */
  save(request: DocumentSaveRequest): Promise<DocumentSaveResult>;
  /** The HTML the stored document is printed from, for the preview. */
  preview(request: DocumentExportRequest): Promise<DocumentPreviewResult>;
  /** Renders the stored document to a PDF and saves it where the user chooses. */
  exportPdf(request: DocumentExportRequest): Promise<DocumentExportResult>;
  /** The stored document as PDF bytes with a file name, for an upload; null when none is stored. */
  pdfFile(
    applicationId: string,
    kind: DocumentExportRequest["kind"],
  ): Promise<{ fileName: string; bytes: Uint8Array } | null>;
}

export interface DocumentServiceOptions {
  repository: DocumentRepository;
  profile: Pick<ProfileRepository, "get">;
  settings: Pick<SettingsRepository, "get">;
  secrets: Pick<SecretStore, "read">;
  engine: DocumentEngine;
  /** Renders one HTML document to PDF bytes (a hidden window in the app). */
  renderPdf(html: string): Promise<Uint8Array>;
  /** Asks where to save the PDF (a native dialog). Null when the user cancels. */
  chooseFile(defaultName: string): Promise<string | null>;
  /** Writes the PDF to the chosen path. */
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
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

  /**
   * The stored document as the HTML it is printed from. It follows the document's own language; a
   * document stored before languages were kept uses the UI language it was generated in.
   */
  async function renderStored(
    request: DocumentExportRequest,
  ): Promise<
    { ok: true; html: string; fileName: string } | { ok: false; code: "not-found" | "no-profile" }
  > {
    const stored = await repository.find(request.applicationId, request.kind);
    if (stored === null) return { ok: false, code: "not-found" };
    const saved = await options.profile.get();
    if (saved === null) return { ok: false, code: "no-profile" };
    const language = stored.language ?? (await uiLanguage());
    const labels = documentLabels(language);
    const html = renderDocumentHtml(
      stored.content,
      saved.profile.contact,
      labels,
      language,
      saved.profile.links,
      saved.profile.headline,
    );
    // "Maria Rossi - Curriculum Vitae.pdf": a name that makes sense to the employer who receives it.
    const title = stored.content.kind === "cv" ? labels.cvTitle : labels.coverLetterTitle;
    const fileName = `${[saved.profile.contact.fullName, title]
      .filter((part) => part.trim() !== "")
      .join(" - ")
      .replace(/[\\/:*?"<>|]+/g, " ")
      .trim()}.pdf`;
    return { ok: true, html, fileName };
  }

  /** The user's choice for the application, else the posting's language, else the UI's. */
  async function languageFor(
    applicationId: string,
    postingLanguage: string | null | undefined,
  ): Promise<DocumentLanguageChoice> {
    const chosen = await repository.chosenLanguage(applicationId);
    if (chosen !== null) return { language: chosen, source: "chosen" };
    return documentLanguageFor(postingLanguage);
  }

  return {
    async setLanguage(request) {
      const saved = await repository.setChosenLanguage(request.applicationId, request.language);
      // Documents written in another language no longer fit: they are removed, to be written again.
      if (saved) await repository.deleteNotIn(request.applicationId, request.language);
      return saved;
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
      if (!ai.enabled) return { ok: false, code: "not-configured" };
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

    async preview(request) {
      const rendered = await renderStored(request);
      return rendered.ok ? { ok: true, html: rendered.html } : rendered;
    },

    async exportPdf(request) {
      const rendered = await renderStored(request);
      if (!rendered.ok) return rendered;
      try {
        const bytes = await options.renderPdf(rendered.html);
        const path = await options.chooseFile(rendered.fileName);
        if (path === null) return { ok: false, code: "cancelled" };
        await options.writeFile(path, bytes);
        const document = await repository.markExported(request.applicationId, request.kind, now());
        if (document === null) return { ok: false, code: "not-found" };
        return { ok: true, document };
      } catch {
        return { ok: false, code: "export-failed" };
      }
    },

    async pdfFile(applicationId, kind) {
      const rendered = await renderStored({ applicationId, kind });
      if (!rendered.ok) return null;
      try {
        return { fileName: rendered.fileName, bytes: await options.renderPdf(rendered.html) };
      } catch {
        return null;
      }
    },
  };
}
