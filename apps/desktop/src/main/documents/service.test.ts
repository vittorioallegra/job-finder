// protects=the document service generates a document only after the profile, the consent for a cloud provider and the key are in place, stores what the engine returns, refuses saved edits that break the profile, exports and reveals PDFs only for stored documents, and writes each document in the posting's language (or the UI language when the posting's is missing or unsupported), unless the user picks another;
// fails_when=a cloud provider is called without consent, a document is generated without a profile, an engine answer that breaks the rules is stored, a saved edit with an invented employer is stored, a PDF is written for a missing document, reveal opens a file that was never exported, an Italian posting gets an English document, a user's pick is ignored, or an export renders in a language other than the stored one;
// no_claim=the engine answers and the PDF bytes are scripted doubles; the AI itself and the Chromium print are not exercised here;
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openAppDatabase, type AppDatabase } from "../db/database";
import { applicationDocuments, applications, companies, jobs } from "@job-finder/core";
import { emptyProfile, type Profile } from "@job-finder/core/profile";
import type { DocumentContent } from "@job-finder/core/documents/schema";
import { createDocumentRepository } from "./repository";
import { createDocumentService, type DocumentServiceOptions } from "./service";
import type { GenerateDocumentRequest } from "../../engine/protocol";
import { EngineUnavailableError } from "../engine/supervisor";
import type { SettingsRepository } from "../settings/repository";

const repoMigrations = resolve(__dirname, "../../../drizzle");
const NOW = Date.UTC(2026, 10, 23);

function profile(): Profile {
  return {
    ...emptyProfile(),
    contact: { fullName: "Maria Rossi", email: "maria@example.com", phone: "", location: "Milano" },
    experience: [
      {
        company: "Acme",
        title: "Engineer",
        location: "Milano",
        startDate: "2019",
        endDate: "2024",
        bullets: ["Cut latency by 40%"],
      },
    ],
  };
}

const VALID_LETTER: DocumentContent = {
  kind: "cover-letter",
  letter: { paragraphs: ["I cut latency by 40% at Acme."] },
};

/** Settings with a local provider (no consent needed) or a cloud one. */
function settingsFor(
  cloud: boolean,
  uiLanguage: "en" | "it" = "en",
): Pick<SettingsRepository, "get"> {
  return {
    get: async () =>
      ({
        ai: {
          provider: cloud ? "anthropic" : "openai-compatible",
          model: "model-x",
          baseUrl: cloud ? "" : "http://localhost:1234/v1",
          contextSize: 8192,
        },
        ui: { language: uiLanguage },
      }) as never,
  };
}

describe("document service", () => {
  let database: AppDatabase;
  let requests: GenerateDocumentRequest[];
  let engineAnswer: () => Promise<unknown>;
  let pdfWrites: string[];
  let revealed: string[];
  let stored: Profile | null;

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), "job-finder-documents-service-"));
    database = await openAppDatabase({
      file: join(dir, "job-finder.sqlite"),
      migrationsFolder: repoMigrations,
      backupDirectory: join(dir, "backups"),
    });
    await database.db.insert(companies).values([
      {
        id: "c1",
        name: "Globex",
        careersUrl: "https://g.test",
        ats: null,
        slug: null,
        createdAt: 1,
      },
    ]);
    await database.db.insert(jobs).values([
      {
        id: "j1",
        companyId: "c1",
        fingerprint: "fp1",
        title: "Backend Engineer",
        description: "Build APIs.",
        url: "https://x.test/1",
        applyUrl: "https://x.test/1/apply",
        locations: "[]",
        workMode: "unknown",
        employmentType: "unknown",
        seniority: "unknown",
        visaSponsorship: "unknown",
        firstSeenAt: NOW,
        lastSeenAt: NOW,
      },
    ]);
    await database.db
      .insert(applications)
      .values([
        { id: "a1", jobId: "j1", status: "preparing", createdAt: NOW, statusChangedAt: NOW },
      ]);
    requests = [];
    pdfWrites = [];
    revealed = [];
    stored = profile();
    engineAnswer = async () => ({ ok: true, content: VALID_LETTER, warnings: [] });
  });

  afterEach(() => {
    database.close();
  });

  function build(overrides: Partial<DocumentServiceOptions> = {}, cloud = false) {
    return createDocumentService({
      repository: createDocumentRepository(database.db),
      profile: {
        get: async () => (stored === null ? null : { profile: stored, version: 1, updatedAt: NOW }),
      } as DocumentServiceOptions["profile"],
      settings: settingsFor(cloud),
      secrets: { read: async () => "key-value" },
      engine: {
        generateDocument: async (request) => {
          requests.push(request);
          return (await engineAnswer()) as never;
        },
      },
      renderPdf: async () => new Uint8Array([37, 80, 68, 70]),
      writePdf: async (applicationId, kind) => {
        pdfWrites.push(`${applicationId}/${kind}`);
      },
      pdfPath: (applicationId, kind) => `/store/${applicationId}/${kind}.pdf`,
      revealPath: (path) => revealed.push(path),
      systemLocale: () => "en-US",
      now: () => NOW,
      ...overrides,
    });
  }

  it("generates a document from the profile and the posting, and stores it", async () => {
    const result = await build().generate({
      applicationId: "a1",
      kind: "cover-letter",
      consent: false,
    });

    expect(result).toMatchObject({
      ok: true,
      document: { kind: "cover-letter", exportedAt: null },
    });
    expect(requests[0]).toMatchObject({
      kind: "cover-letter",
      job: { title: "Backend Engineer", companyName: "Globex", description: "Build APIs." },
      language: "en",
      ai: { config: { model: "model-x", apiKey: "key-value" }, contextSize: 8192 },
    });
    expect((await build().get("a1")).coverLetter?.content).toEqual(VALID_LETTER);
  });

  it("refuses a cloud provider without consent, before any engine call", async () => {
    const result = await build({}, true).generate({
      applicationId: "a1",
      kind: "cv",
      consent: false,
    });

    expect(result).toEqual({ ok: false, code: "consent-required" });
    expect(requests).toHaveLength(0);
  });

  it("refuses to generate without a profile, and for a missing application", async () => {
    stored = null;
    expect(await build().generate({ applicationId: "a1", kind: "cv", consent: false })).toEqual({
      ok: false,
      code: "no-profile",
    });

    stored = profile();
    expect(
      await build().generate({ applicationId: "missing", kind: "cv", consent: false }),
    ).toEqual({ ok: false, code: "not-found" });
    expect(requests).toHaveLength(0);
  });

  it("reports an engine that is down as engine-unavailable, and an AI failure as its code", async () => {
    engineAnswer = async () => {
      throw new EngineUnavailableError("stopped");
    };
    expect(await build().generate({ applicationId: "a1", kind: "cv", consent: false })).toEqual({
      ok: false,
      code: "engine-unavailable",
    });

    engineAnswer = async () => ({ ok: false, code: "invalid-key" });
    expect(await build().generate({ applicationId: "a1", kind: "cv", consent: false })).toEqual({
      ok: false,
      code: "invalid-key",
    });
  });

  it("stores edits that keep the profile's facts, and refuses one that invents a number", async () => {
    await build().generate({ applicationId: "a1", kind: "cover-letter", consent: false });

    const ok = await build().save({
      applicationId: "a1",
      content: { kind: "cover-letter", letter: { paragraphs: ["I cut latency by 40%."] } },
    });
    expect(ok.ok).toBe(true);

    const refused = await build().save({
      applicationId: "a1",
      content: { kind: "cover-letter", letter: { paragraphs: ["I cut latency by 90%."] } },
    });
    expect(refused).toEqual({
      ok: false,
      code: "validation-failed",
      issues: [{ code: "numbers-not-in-profile", path: "paragraphs.0" }],
    });
    expect((await build().get("a1")).coverLetter?.content).toEqual({
      kind: "cover-letter",
      letter: { paragraphs: ["I cut latency by 40%."] },
    });
  });

  it("exports a stored document to its PDF file and records the export time", async () => {
    await build().generate({ applicationId: "a1", kind: "cover-letter", consent: false });

    const result = await build().exportPdf({ applicationId: "a1", kind: "cover-letter" });

    expect(pdfWrites).toEqual(["a1/cover-letter"]);
    expect(result).toMatchObject({ ok: true, document: { exportedAt: NOW } });
  });

  it("does not export a missing document, and reports a failed render as export-failed", async () => {
    expect(await build().exportPdf({ applicationId: "a1", kind: "cv" })).toEqual({
      ok: false,
      code: "not-found",
    });

    await build().generate({ applicationId: "a1", kind: "cover-letter", consent: false });
    const failing = build({
      renderPdf: async () => {
        throw new Error("print failed");
      },
    });
    expect(await failing.exportPdf({ applicationId: "a1", kind: "cover-letter" })).toEqual({
      ok: false,
      code: "export-failed",
    });
    expect(pdfWrites).toHaveLength(0);
  });

  it("reveals only an exported PDF", async () => {
    await build().generate({ applicationId: "a1", kind: "cover-letter", consent: false });
    expect(await build().reveal({ applicationId: "a1", kind: "cover-letter" })).toBe(false);
    expect(revealed).toEqual([]);

    await build().exportPdf({ applicationId: "a1", kind: "cover-letter" });
    expect(await build().reveal({ applicationId: "a1", kind: "cover-letter" })).toBe(true);
    expect(revealed).toEqual(["/store/a1/cover-letter.pdf"]);
  });

  it("writes the document in the posting's language, and in the UI language when the posting's is unsupported", async () => {
    await database.db.update(jobs).set({ language: "it" }).where(eq(jobs.id, "j1"));
    await build().generate({ applicationId: "a1", kind: "cover-letter", consent: false });
    expect(requests[0]).toMatchObject({ language: "it" });
    expect((await build().get("a1")).coverLetter?.language).toBe("it");
    expect((await build().get("a1")).defaultLanguage).toEqual({
      language: "it",
      source: "posting",
    });

    await database.db.update(jobs).set({ language: "de" }).where(eq(jobs.id, "j1"));
    await build({ settings: settingsFor(false, "it") }).generate({
      applicationId: "a1",
      kind: "cover-letter",
      consent: false,
    });
    expect(requests[1]).toMatchObject({ language: "it" });
    expect((await build({ settings: settingsFor(false, "it") }).get("a1")).defaultLanguage).toEqual(
      { language: "it", source: "ui" },
    );
  });

  it("uses the language the user picks over the posting's", async () => {
    await database.db.update(jobs).set({ language: "it" }).where(eq(jobs.id, "j1"));
    await build().generate({
      applicationId: "a1",
      kind: "cv",
      consent: false,
      language: "en",
    });

    expect(requests[0]).toMatchObject({ language: "en" });
    expect((await build().get("a1")).cv?.language).toBe("en");
  });

  it("keeps the document's language on a saved edit, and renders the PDF in that language", async () => {
    await database.db.update(jobs).set({ language: "it" }).where(eq(jobs.id, "j1"));
    await build({ settings: settingsFor(false, "en") }).generate({
      applicationId: "a1",
      kind: "cover-letter",
      consent: false,
    });
    await build({ settings: settingsFor(false, "en") }).save({
      applicationId: "a1",
      content: {
        kind: "cover-letter",
        letter: { paragraphs: ["Ho tagliato la latenza del 40%."] },
      },
    });
    expect(
      (await build({ settings: settingsFor(false, "en") }).get("a1")).coverLetter?.language,
    ).toBe("it");

    const html: string[] = [];
    await build({
      settings: settingsFor(false, "en"),
      renderPdf: async (document) => {
        html.push(document);
        return new Uint8Array([37]);
      },
    }).exportPdf({ applicationId: "a1", kind: "cover-letter" });
    expect(html[0]).toContain('lang="it"');
  });

  it("renders a document stored before languages were kept in the UI language", async () => {
    await build({ settings: settingsFor(false, "it") }).generate({
      applicationId: "a1",
      kind: "cover-letter",
      consent: false,
    });
    await database.db
      .update(applicationDocuments)
      .set({ language: null })
      .where(eq(applicationDocuments.applicationId, "a1"));

    const html: string[] = [];
    await build({
      settings: settingsFor(false, "it"),
      renderPdf: async (document) => {
        html.push(document);
        return new Uint8Array([37]);
      },
    }).exportPdf({ applicationId: "a1", kind: "cover-letter" });
    expect(html[0]).toContain('lang="it"');
  });
});
