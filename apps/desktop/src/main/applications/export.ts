import { toCsv } from "@job-finder/core/applications";
import type { ApplicationExportResult } from "@job-finder/bridge";
import type { ApplicationRepository } from "./repository";

/** Excel reads UTF-8 CSV as UTF-8 only when it starts with a byte order mark. */
const BYTE_ORDER_MARK = "﻿";

export const APPLICATION_CSV_HEADER = [
  "Company",
  "Job title",
  "Status",
  "Status changed",
  "Created",
  "Job URL",
  "Apply URL",
  "Notes",
] as const;

export interface ApplicationExportDeps {
  repository: Pick<ApplicationRepository, "listDetails">;
  /** Asks the user for a file. Resolves null when the dialog is cancelled. */
  chooseFile: (defaultName: string) => Promise<string | null>;
  writeFile: (path: string, content: string) => Promise<void>;
  /** The export's date, for the default file name. */
  today?: () => Date;
}

export interface ApplicationExport {
  exportCsv(): Promise<ApplicationExportResult>;
}

/**
 * Writes every application as CSV. The columns are the application's own fields and its notes, so no
 * settings or keys can reach the file; cells that a spreadsheet would run as formulas are escaped by
 * the core CSV writer.
 */
export function createApplicationExport(deps: ApplicationExportDeps): ApplicationExport {
  return {
    async exportCsv() {
      const today = (deps.today ?? (() => new Date()))();
      const defaultName = `job-finder-applications-${today.toISOString().slice(0, 10)}.csv`;
      const path = await deps.chooseFile(defaultName);
      if (path === null) return { ok: false, code: "cancelled" };

      const rows = await deps.repository.listDetails();
      const content =
        BYTE_ORDER_MARK +
        toCsv(
          APPLICATION_CSV_HEADER,
          rows.map((row) => [
            row.companyName,
            row.jobTitle,
            row.status,
            new Date(row.statusChangedAt).toISOString(),
            new Date(row.createdAt).toISOString(),
            row.jobUrl,
            row.applyUrl,
            row.events
              .filter((event) => event.note !== null)
              .map((event) => `${new Date(event.at).toISOString()} ${event.note}`)
              .join(" | "),
          ]),
        );
      try {
        await deps.writeFile(path, content);
      } catch {
        return { ok: false, code: "write-failed" };
      }
      return { ok: true, path, count: rows.length };
    },
  };
}
