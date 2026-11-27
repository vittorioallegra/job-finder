import type { ProfileExportRequest, ProfileExportResult } from "@job-finder/bridge";
import { profileToCv, renderCvHtml, type CvLabels } from "@job-finder/core/profile/cv";
import type { buildCvDocx } from "@job-finder/core/profile/cv-docx";
import type { DocumentLanguage } from "@job-finder/core/documents/language";
import { createTranslator } from "../i18n";
import type { ProfileRepository } from "./repository";

export interface ProfileExportService {
  /** Builds the CV from the saved profile, asks where to save it and writes it. */
  exportCv(request: ProfileExportRequest): Promise<ProfileExportResult>;
}

export interface ProfileExportServiceOptions {
  profile: Pick<ProfileRepository, "get">;
  /** Renders one HTML page to PDF bytes (a hidden window in the app). */
  renderPdf(html: string): Promise<Uint8Array>;
  /** Builds the Word file from the CV (`buildCvDocx` in core). */
  buildDocx: typeof buildCvDocx;
  /** Asks where to save the file (a native dialog). Null when the user cancels. */
  chooseFile(defaultName: string, format: ProfileExportRequest["format"]): Promise<string | null>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
}

/** The headings and words of a CV in one language: the main i18n keys under `documents.labels`. */
export function cvLabels(language: DocumentLanguage): CvLabels {
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
    courses: t("documents.labels.courses"),
    languages: t("documents.labels.languages"),
    certifications: t("documents.labels.certifications"),
    native: t("documents.labels.native"),
  };
}

/**
 * Main side of "export the profile as a CV". The whole profile goes into the file, in the language
 * the user picked for the headings and dates; the profile's own text is not translated. Nothing is
 * stored: the file goes where the user chooses.
 */
export function createProfileExportService(
  options: ProfileExportServiceOptions,
): ProfileExportService {
  return {
    async exportCv(request) {
      const saved = await options.profile.get();
      if (saved === null) return { ok: false, code: "no-profile" };
      try {
        const labels = cvLabels(request.language);
        const cv = profileToCv(saved.profile, labels);
        const bytes =
          request.format === "pdf"
            ? await options.renderPdf(renderCvHtml(cv, request.language, labels.cvTitle))
            : await options.buildDocx(cv, request.language, labels.cvTitle);
        // "Maria Rossi - CV.pdf": a name that makes sense to the employer who receives it.
        const base = [saved.profile.contact.fullName, labels.cvTitle]
          .filter((part) => part.trim() !== "")
          .join(" - ")
          .replace(/[\\/:*?"<>|]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const path = await options.chooseFile(`${base}.${request.format}`, request.format);
        if (path === null) return { ok: false, code: "cancelled" };
        await options.writeFile(path, bytes);
        return { ok: true };
      } catch {
        return { ok: false, code: "export-failed" };
      }
    },
  };
}
