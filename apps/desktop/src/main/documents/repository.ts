import { and, eq } from "drizzle-orm";
import { applicationDocuments, applications, companies, jobs } from "@job-finder/core";
import type { DocumentKind, DocumentContent } from "@job-finder/core/documents/schema";
import type { DocumentLanguage } from "@job-finder/core/documents/language";
import type { ApplicationDocuments, DocumentRecord } from "@job-finder/bridge";
import type { DocumentJob } from "@job-finder/core/documents/prompt";
import type { AppDb } from "../db/operations";

/** The stored documents of an application (each null until generated). */
export type StoredDocuments = Omit<ApplicationDocuments, "defaultLanguage">;

export interface DocumentRepository {
  /** The stored documents of an application (each null until generated). */
  forApplication(applicationId: string): Promise<StoredDocuments>;
  /** The language the user chose for the application's documents, or null. */
  chosenLanguage(applicationId: string): Promise<DocumentLanguage | null>;
  /** Saves the user's language choice. Resolves false when the application does not exist. */
  setChosenLanguage(applicationId: string, language: DocumentLanguage): Promise<boolean>;
  /**
   * Deletes the application's documents that are not written in `language` (or whose language is
   * unknown). Returns how many were deleted.
   */
  deleteNotIn(applicationId: string, language: DocumentLanguage): Promise<number>;
  /** One stored document, or null when none was generated for the application yet. */
  find(applicationId: string, kind: DocumentKind): Promise<DocumentRecord | null>;
  /**
   * The job and company of an application, with the posting's normalized language (null when
   * unknown), or null when the application does not exist.
   */
  jobOf(applicationId: string): Promise<(DocumentJob & { language: string | null }) | null>;
  /**
   * Stores a document (replaces the one of that kind) with its language. Keeps the export time:
   * an edit after it marks the PDF old.
   */
  save(
    applicationId: string,
    kind: DocumentKind,
    content: DocumentContent,
    language: DocumentLanguage,
    now: number,
  ): Promise<DocumentRecord>;
  /** Records a PDF export. Resolves null when no document of that kind exists. */
  markExported(
    applicationId: string,
    kind: DocumentKind,
    now: number,
  ): Promise<DocumentRecord | null>;
}

type Row = typeof applicationDocuments.$inferSelect;

function toRecord(row: Row): DocumentRecord {
  return {
    kind: row.kind,
    content: JSON.parse(row.content) as DocumentContent,
    language: (row.language as DocumentLanguage | null) ?? null,
    updatedAt: row.updatedAt,
    exportedAt: row.exportedAt,
  };
}

export function createDocumentRepository(db: AppDb): DocumentRepository {
  async function find(applicationId: string, kind: DocumentKind): Promise<DocumentRecord | null> {
    const [row] = await db
      .select()
      .from(applicationDocuments)
      .where(
        and(
          eq(applicationDocuments.applicationId, applicationId),
          eq(applicationDocuments.kind, kind),
        ),
      )
      .limit(1);
    return row ? toRecord(row) : null;
  }

  return {
    find,

    async deleteNotIn(applicationId, language) {
      const rows = await db
        .select({ kind: applicationDocuments.kind, language: applicationDocuments.language })
        .from(applicationDocuments)
        .where(eq(applicationDocuments.applicationId, applicationId));
      const stale = rows.filter((row) => row.language !== language);
      for (const row of stale) {
        await db
          .delete(applicationDocuments)
          .where(
            and(
              eq(applicationDocuments.applicationId, applicationId),
              eq(applicationDocuments.kind, row.kind),
            ),
          );
      }
      return stale.length;
    },

    async chosenLanguage(applicationId) {
      const [row] = await db
        .select({ language: applications.documentLanguage })
        .from(applications)
        .where(eq(applications.id, applicationId))
        .limit(1);
      return (row?.language as DocumentLanguage | null | undefined) ?? null;
    },

    async setChosenLanguage(applicationId, language) {
      const [row] = await db
        .select({ id: applications.id })
        .from(applications)
        .where(eq(applications.id, applicationId))
        .limit(1);
      if (!row) return false;
      await db
        .update(applications)
        .set({ documentLanguage: language })
        .where(eq(applications.id, applicationId));
      return true;
    },

    async forApplication(applicationId) {
      const rows = await db
        .select()
        .from(applicationDocuments)
        .where(eq(applicationDocuments.applicationId, applicationId));
      const byKind = new Map(rows.map((row) => [row.kind, toRecord(row)]));
      return {
        applicationId,
        cv: byKind.get("cv") ?? null,
        coverLetter: byKind.get("cover-letter") ?? null,
      };
    },

    async jobOf(applicationId) {
      // Every selected column has a distinct name: the proxy maps rows by column name, so two
      // `id` columns (application and job) would collide. The job id is not needed here.
      const [row] = await db
        .select({
          jobTitle: jobs.title,
          jobDescription: jobs.description,
          jobLanguage: jobs.language,
          companyName: companies.name,
        })
        .from(applications)
        .innerJoin(jobs, eq(applications.jobId, jobs.id))
        .innerJoin(companies, eq(jobs.companyId, companies.id))
        .where(eq(applications.id, applicationId))
        .limit(1);
      if (!row) return null;
      return {
        title: row.jobTitle,
        companyName: row.companyName,
        description: row.jobDescription,
        language: row.jobLanguage,
      };
    },

    async save(applicationId, kind, content, language, now) {
      const serialized = JSON.stringify(content);
      await db
        .insert(applicationDocuments)
        .values({
          applicationId,
          kind,
          content: serialized,
          language,
          updatedAt: now,
          exportedAt: null,
        })
        .onConflictDoUpdate({
          target: [applicationDocuments.applicationId, applicationDocuments.kind],
          set: { content: serialized, language, updatedAt: now },
        });
      const saved = await find(applicationId, kind);
      if (saved === null) {
        throw new Error("the saved document could not be read back");
      }
      return saved;
    },

    async markExported(applicationId, kind, now) {
      await db
        .update(applicationDocuments)
        .set({ exportedAt: now })
        .where(
          and(
            eq(applicationDocuments.applicationId, applicationId),
            eq(applicationDocuments.kind, kind),
          ),
        );
      return find(applicationId, kind);
    },
  };
}
