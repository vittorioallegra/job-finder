// protects=the CSV export writes every application with the fixed column header and its notes, escapes formula-like cells, names the file by date, and reports a cancelled dialog or a failed write without writing;
// fails_when=a formula cell reaches the file unescaped, a column other than the fixed header is written, a cancelled dialog still writes, a failed write reports success, or the default name is not dated;
// no_claim=the native save dialog and how a spreadsheet opens the file are not exercised; the core CSV tests cover the escaping rules alone;
import { describe, expect, it } from "vitest";
import type { ApplicationDetail } from "@job-finder/bridge";
import { APPLICATION_CSV_HEADER, createApplicationExport } from "./export";

const row: ApplicationDetail = {
  id: "a1",
  jobId: "j1",
  jobTitle: "=cmd Engineer, Backend",
  companyId: "c1",
  companyName: 'Acme "Labs"',
  status: "applied",
  createdAt: Date.UTC(2026, 9, 1),
  statusChangedAt: Date.UTC(2026, 9, 2),
  jobUrl: "https://x.test/1",
  applyUrl: "https://x.test/1/apply",
  events: [
    { id: "e1", status: "preparing", note: null, at: Date.UTC(2026, 9, 1) },
    { id: "e2", status: "applied", note: "Sent, with CV", at: Date.UTC(2026, 9, 2) },
  ],
};

describe("application CSV export", () => {
  it("writes the fixed header and one escaped line per application, with a byte order mark", async () => {
    const written: string[] = [];
    const exporter = createApplicationExport({
      repository: { listDetails: async () => [row] },
      chooseFile: async (name) => {
        expect(name).toBe("job-finder-applications-2026-11-23.csv");
        return "/exports/apps.csv";
      },
      writeFile: async (_path, content) => {
        written.push(content);
      },
      today: () => new Date(Date.UTC(2026, 10, 23)),
    });

    const result = await exporter.exportCsv();

    expect(result).toEqual({ ok: true, path: "/exports/apps.csv", count: 1 });
    const [content] = written;
    expect(content?.startsWith("﻿")).toBe(true);
    const lines = content!.slice(1).split("\r\n");
    expect(lines[0]).toBe(APPLICATION_CSV_HEADER.join(","));
    expect(lines[1]).toBe(
      [
        '"Acme ""Labs"""',
        '"\'=cmd Engineer, Backend"',
        "applied",
        "2026-10-02T00:00:00.000Z",
        "2026-10-01T00:00:00.000Z",
        "https://x.test/1",
        "https://x.test/1/apply",
        '"2026-10-02T00:00:00.000Z Sent, with CV"',
      ].join(","),
    );
  });

  it("does not write when the dialog is cancelled", async () => {
    let writes = 0;
    const exporter = createApplicationExport({
      repository: { listDetails: async () => [row] },
      chooseFile: async () => null,
      writeFile: async () => {
        writes += 1;
      },
    });
    expect(await exporter.exportCsv()).toEqual({ ok: false, code: "cancelled" });
    expect(writes).toBe(0);
  });

  it("reports a failed write instead of a success", async () => {
    const exporter = createApplicationExport({
      repository: { listDetails: async () => [row] },
      chooseFile: async () => "/read-only/apps.csv",
      writeFile: async () => {
        throw new Error("EACCES");
      },
    });
    expect(await exporter.exportCsv()).toEqual({ ok: false, code: "write-failed" });
  });
});
