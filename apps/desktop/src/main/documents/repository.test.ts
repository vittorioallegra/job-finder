// protects=the document repository stores one document per application and kind, keeps the export time across an edit, reads an application's job and company through a joined query, and reports nothing for an application that has no document;
// fails_when=a second save for the same kind adds a row, an edit clears the export time, the job or company of the wrong application is returned, a joined id collides so the company name is wrong, or a missing document is reported as present;
// no_claim=the SQL of the document table is checked only through this repository against a real migrated database; the service rules are tested in service.test.ts;
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applications, companies, jobs } from "@job-finder/core";
import { openAppDatabase, type AppDatabase } from "../db/database";
import { createDocumentRepository, type DocumentRepository } from "./repository";
import type { DocumentContent } from "@job-finder/core/documents/schema";

const repoMigrations = resolve(__dirname, "../../../drizzle");
const NOW = Date.UTC(2026, 10, 23);

const letter = (text: string): DocumentContent => ({
  kind: "cover-letter",
  letter: { paragraphs: [text] },
});

describe("document repository", () => {
  let database: AppDatabase;
  let repository: DocumentRepository;

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), "job-finder-documents-repo-"));
    database = await openAppDatabase({
      file: join(dir, "job-finder.sqlite"),
      migrationsFolder: repoMigrations,
      backupDirectory: join(dir, "backups"),
    });
    // The company id 'j1' and the job id 'j1' are deliberately equal: a joined read must not mix them up.
    await database.db.insert(companies).values([
      { id: "j1", name: "Acme", careersUrl: "https://a.test", ats: null, slug: null, createdAt: 1 },
      { id: "c2", name: "Beta", careersUrl: "https://b.test", ats: null, slug: null, createdAt: 2 },
    ]);
    await database.db.insert(jobs).values([
      {
        id: "j1",
        companyId: "j1",
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
    repository = createDocumentRepository(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("reads an application's job and company through the joined query", async () => {
    expect(await repository.jobOf("a1")).toEqual({
      title: "Backend Engineer",
      companyName: "Acme",
      description: "Build APIs.",
    });
    expect(await repository.jobOf("missing")).toBeNull();
  });

  it("stores one document per kind and replaces it on the next save", async () => {
    await repository.save("a1", "cover-letter", letter("First."), NOW);
    const replaced = await repository.save("a1", "cover-letter", letter("Second."), NOW + 1);

    expect(replaced.content).toEqual(letter("Second."));
    const documents = await repository.forApplication("a1");
    expect(documents.coverLetter?.content).toEqual(letter("Second."));
    expect(documents.cv).toBeNull();
  });

  it("keeps the export time when the text is edited, so the edit shows the PDF is old", async () => {
    await repository.save("a1", "cover-letter", letter("Draft."), NOW);
    await repository.markExported("a1", "cover-letter", NOW + 10);

    const edited = await repository.save("a1", "cover-letter", letter("Edited."), NOW + 20);

    expect(edited.exportedAt).toBe(NOW + 10);
    expect(edited.updatedAt).toBe(NOW + 20);
  });

  it("reports no document before one is generated, and none for an export without one", async () => {
    expect(await repository.find("a1", "cv")).toBeNull();
    expect(await repository.markExported("a1", "cv", NOW)).toBeNull();
    expect(await repository.forApplication("a1")).toEqual({
      applicationId: "a1",
      cv: null,
      coverLetter: null,
    });
  });
});
