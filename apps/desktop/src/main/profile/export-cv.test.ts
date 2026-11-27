// protects=exporting the profile builds the CV from the whole saved profile in the language picked (headings, dates, the native level), makes a PDF through the page renderer or a Word file through the docx builder, names the file after the person, asks where to save with the right format, writes only after the user chooses, and reports no profile, a closed dialog and a failure as codes;
// fails_when=the wrong format or language is built, a file is written after the dialog is cancelled, a failure escapes as an exception, or the profile is exported without being saved first;
// no_claim=how the printed PDF or the Word file look, which opening them shows, and the native dialog;
import { describe, expect, it } from "vitest";
import { DOCUMENT_LANGUAGES } from "@job-finder/core/documents/language";
import { emptyProfile, type Profile } from "@job-finder/core/profile";
import { createProfileExportService, cvLabels } from "./export-cv";

function profile(): Profile {
  return {
    ...emptyProfile(),
    contact: { fullName: "Maria Rossi", email: "maria@example.com", phone: "", location: "Milano" },
    headline: "Backend engineer",
    experience: [
      {
        company: "Northwind",
        title: "Engineer",
        location: "",
        startDate: "2021",
        endDate: "present",
        bullets: ["Cut latency by 35%"],
      },
    ],
    languages: [{ name: "Italiano", level: "native" }],
  } as Profile;
}

function setup(options: { saved?: Profile | null; chosen?: string | null; fail?: boolean } = {}) {
  const calls: string[] = [];
  const written: Array<{ path: string; bytes: Uint8Array }> = [];
  const service = createProfileExportService({
    profile: {
      get: async () =>
        options.saved === null
          ? null
          : { profile: options.saved ?? profile(), version: 1, updatedAt: 1 },
    },
    renderPdf: async (html) => {
      calls.push(`pdf:${html.includes('lang="it"') ? "it" : "en"}`);
      if (options.fail) throw new Error("boom");
      return new TextEncoder().encode(html);
    },
    buildDocx: async (_cv, language) => {
      calls.push(`docx:${language}`);
      return new Uint8Array([1, 2, 3]);
    },
    chooseFile: async (defaultName, format) => {
      calls.push(`choose:${defaultName}:${format}`);
      return options.chosen === undefined ? `/tmp/${defaultName}` : options.chosen;
    },
    writeFile: async (path, bytes) => {
      written.push({ path, bytes });
    },
  });
  return { service, calls, written };
}

describe("profile CV export", () => {
  it("makes a PDF from the whole profile in the language picked and saves it under the person's name", async () => {
    const { service, calls, written } = setup();

    expect(await service.exportCv({ language: "it", format: "pdf" })).toEqual({ ok: true });

    expect(calls).toEqual(["pdf:it", "choose:Maria Rossi - CV.pdf:pdf"]);
    const html = new TextDecoder().decode(written[0]?.bytes);
    expect(html).toContain("<h2>Esperienza</h2>");
    expect(html).toContain("Presente");
    expect(html).toContain("Madrelingua");
    expect(html).toContain("Cut latency by 35%");
    expect(written[0]?.path).toBe("/tmp/Maria Rossi - CV.pdf");
  });

  it("makes a Word file in English with the docx builder", async () => {
    const { service, calls, written } = setup();
    expect(await service.exportCv({ language: "en", format: "docx" })).toEqual({ ok: true });
    expect(calls).toEqual(["docx:en", "choose:Maria Rossi - CV.docx:docx"]);
    expect(Array.from(written[0]?.bytes ?? [])).toEqual([1, 2, 3]);
  });

  it("writes nothing when the user closes the dialog, and reports no profile or a failure as codes", async () => {
    const cancelled = setup({ chosen: null });
    expect(await cancelled.service.exportCv({ language: "en", format: "pdf" })).toEqual({
      ok: false,
      code: "cancelled",
    });
    expect(cancelled.written).toEqual([]);

    const none = setup({ saved: null });
    expect(await none.service.exportCv({ language: "en", format: "pdf" })).toEqual({
      ok: false,
      code: "no-profile",
    });
    expect(none.calls).toEqual([]);

    const failing = setup({ fail: true });
    expect(await failing.service.exportCv({ language: "en", format: "pdf" })).toEqual({
      ok: false,
      code: "export-failed",
    });
    expect(failing.written).toEqual([]);
  });

  it("names the file safely when the name has characters a file cannot hold", async () => {
    const odd = {
      ...profile(),
      contact: { ...profile().contact, fullName: 'Maria/Rossi: "CV"' },
    } as Profile;
    const { service, calls } = setup({ saved: odd });
    await service.exportCv({ language: "en", format: "pdf" });
    expect(calls[1]).toBe("choose:Maria Rossi CV - CV.pdf:pdf");
  });

  it("has every heading in every language the documents support", () => {
    for (const language of DOCUMENT_LANGUAGES) {
      for (const value of Object.values(cvLabels(language))) expect(value.trim()).not.toBe("");
    }
    expect(cvLabels("it").languages).toBe("Lingue");
    expect(cvLabels("en").languages).toBe("Languages");
  });
});
