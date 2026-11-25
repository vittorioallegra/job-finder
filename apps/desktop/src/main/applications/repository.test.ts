// protects=the application repository bookmarks a job once, starts preparing through the duplicate guard (two confirmations for the same job or fingerprint, one for the same company within 90 days, none past that), moves statuses only along the planned moves while recording every change as an event, and the job list's hide-applied filter and status follow the latest application;
// fails_when=a second bookmark creates a row, a bookmark or preparing application counts as a duplicate, a same-job match starts with fewer than two confirmations, a company match outside 90 days warns, a start creates a second open application for the same job, an invalid move is stored, a change or note leaves no event, or a submitted job stays listed with hide-applied on;
// no_claim=the IPC routing, the native save dialog and the CSV file are not covered here (the handler and export tests cover them); the duplicate window uses the given clock, not the system time;
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applicationDocuments, companies, jobs } from "@job-finder/core";
import { JobFilterSchema } from "@job-finder/core/filters";
import { openAppDatabase, type AppDatabase } from "../db/database";
import { createIngestRepository, type IngestRepository } from "../ingest/repository";
import { createApplicationRepository, type ApplicationRepository } from "./repository";

const repoMigrations = resolve(__dirname, "../../../drizzle");
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 23);

/** Sequential ids, so the expectations can name them. */
function ids(prefix: string): () => string {
  let next = 0;
  return () => `${prefix}-${++next}`;
}

describe("application repository", () => {
  let database: AppDatabase;
  let repository: ApplicationRepository;
  let listing: IngestRepository;

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), "job-finder-applications-"));
    database = await openAppDatabase({
      file: join(dir, "job-finder.sqlite"),
      migrationsFolder: repoMigrations,
      backupDirectory: join(dir, "backups"),
    });
    await database.db.insert(companies).values([
      { id: "c1", name: "Acme", careersUrl: "https://a.test", ats: null, slug: null, createdAt: 1 },
      { id: "c2", name: "Beta", careersUrl: "https://b.test", ats: null, slug: null, createdAt: 2 },
    ]);
    const job = (id: string, companyId: string, fingerprint: string, title: string) => ({
      id,
      companyId,
      fingerprint,
      title,
      description: "Text",
      url: `https://x.test/${id}`,
      applyUrl: `https://x.test/${id}/apply`,
      locations: "[]",
      workMode: "unknown",
      employmentType: "unknown",
      seniority: "unknown",
      visaSponsorship: "unknown",
      firstSeenAt: NOW,
      lastSeenAt: NOW,
    });
    await database.db.insert(jobs).values([
      job("j1", "c1", "fp-backend", "Backend Engineer"),
      // The same posting from another source: same fingerprint, different job row.
      job("j2", "c1", "fp-backend", "Backend Engineer (EU)"),
      job("j3", "c1", "fp-frontend", "Frontend Developer"),
      job("j4", "c2", "fp-data", "Data Engineer"),
    ]);
    repository = createApplicationRepository(database.db);
    listing = createIngestRepository(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("bookmarks a job once, lists it as bookmarked, and removes the bookmark on request", async () => {
    const newId = ids("a");
    expect(await repository.bookmark({ jobId: "j1", bookmarked: true }, NOW, newId)).toBe(true);
    expect(await repository.bookmark({ jobId: "j1", bookmarked: true }, NOW, newId)).toBe(true);
    expect((await repository.list()).map((item) => item.status)).toEqual(["bookmarked"]);

    const listed = await listing.listJobs({ filter: {}, sort: "affinity" }, NOW);
    expect(listed.find((job) => job.id === "j1")?.applicationStatus).toBe("bookmarked");
    expect(listed.find((job) => job.id === "j1")?.applicationId).toBe("a-1");

    expect(await repository.bookmark({ jobId: "j1", bookmarked: false }, NOW, newId)).toBe(true);
    expect(await repository.list()).toEqual([]);
    expect(await repository.bookmark({ jobId: "missing", bookmarked: true }, NOW, newId)).toBe(
      false,
    );
  });

  it("starts preparing a job once and returns the open application on a second start", async () => {
    const newId = ids("a");
    const first = await repository.start({ jobId: "j1", confirmations: 0 }, NOW, newId);
    const second = await repository.start({ jobId: "j1", confirmations: 0 }, NOW + 1, newId);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.application.id).toBe(first.application.id);
    expect(first.application).toMatchObject({ status: "preparing", jobTitle: "Backend Engineer" });
    // The history starts with the job being saved, whether or not it was bookmarked first.
    expect(first.application.events.map((event) => event.status)).toEqual([
      "bookmarked",
      "preparing",
    ]);
    expect(await repository.list()).toHaveLength(1);
  });

  it("creates one application when the same job is started twice at once", async () => {
    // protects=concurrent starts of one job (a double click) leave a single preparing application; fails_when=two starts that overlap each create an application; no_claim=starts for different jobs;
    const newId = ids("a");
    const [first, second] = await Promise.all([
      repository.start({ jobId: "j1", confirmations: 0 }, NOW, newId),
      repository.start({ jobId: "j1", confirmations: 0 }, NOW, newId),
    ]);

    expect(first.ok && second.ok).toBe(true);
    expect(await repository.list()).toHaveLength(1);
  });

  it("moves a bookmark to preparing when the job is started", async () => {
    const newId = ids("a");
    await repository.bookmark({ jobId: "j3", bookmarked: true }, NOW, newId);
    const started = await repository.start({ jobId: "j3", confirmations: 0 }, NOW + 5, newId);
    expect(started.ok && started.application.status).toBe("preparing");
    expect(started.ok && started.application.events.map((event) => event.status)).toEqual([
      "bookmarked",
      "preparing",
    ]);
    expect(await repository.list()).toHaveLength(1);
  });

  it("needs two confirmations to prepare a job whose posting already has an application past preparing", async () => {
    const newId = ids("a");
    const first = await repository.start({ jobId: "j1", confirmations: 0 }, NOW, newId);
    if (!first.ok) throw new Error("expected a start");
    await repository.update({ applicationId: first.application.id, status: "ready" }, NOW, newId);
    await repository.update({ applicationId: first.application.id, status: "applied" }, NOW, newId);

    const check = await repository.check("j1", NOW);
    expect(check.requiredConfirmations).toBe(2);
    expect(check.sameJob.map((item) => item.jobId)).toEqual(["j1"]);

    // The same posting from another source has the same fingerprint, so it is refused the same way.
    const refusedOnce = await repository.start({ jobId: "j2", confirmations: 1 }, NOW, newId);
    expect(refusedOnce).toMatchObject({
      ok: false,
      code: "duplicate-confirmation-required",
      duplicates: { requiredConfirmations: 2 },
    });
    expect(await repository.list()).toHaveLength(1);

    const confirmed = await repository.start({ jobId: "j2", confirmations: 2 }, NOW, newId);
    expect(confirmed.ok && confirmed.application.status).toBe("preparing");
    expect(await repository.list()).toHaveLength(2);
  });

  it("needs one confirmation for the same company within 90 days, and none once the window has passed", async () => {
    const newId = ids("a");
    const applied = await repository.start(
      { jobId: "j1", confirmations: 0 },
      NOW - 100 * DAY,
      newId,
    );
    if (!applied.ok) throw new Error("expected a start");
    await repository.update(
      { applicationId: applied.application.id, status: "ready" },
      NOW - 95 * DAY,
      newId,
    );
    await repository.update(
      { applicationId: applied.application.id, status: "applied" },
      NOW - 91 * DAY,
      newId,
    );
    // Applied 91 days before NOW: the company warning has expired.
    expect(await repository.check("j3", NOW)).toEqual({
      sameJob: [],
      sameCompany: [],
      requiredConfirmations: 0,
    });

    await repository.update(
      { applicationId: applied.application.id, status: "accepted" },
      NOW - 10 * DAY,
      newId,
    );
    const check = await repository.check("j3", NOW);
    expect(check.requiredConfirmations).toBe(1);
    expect(check.sameCompany.map((item) => item.jobId)).toEqual(["j1"]);
    expect(await repository.start({ jobId: "j3", confirmations: 0 }, NOW, newId)).toMatchObject({
      ok: false,
      code: "duplicate-confirmation-required",
    });
    expect((await repository.start({ jobId: "j3", confirmations: 1 }, NOW, newId)).ok).toBe(true);
  });

  it("does not count bookmarks or preparations as duplicates", async () => {
    const newId = ids("a");
    await repository.bookmark({ jobId: "j1", bookmarked: true }, NOW, newId);
    await repository.start({ jobId: "j4", confirmations: 0 }, NOW, newId);
    expect(await repository.check("j2", NOW)).toEqual({
      sameJob: [],
      sameCompany: [],
      requiredConfirmations: 0,
    });
    expect((await repository.start({ jobId: "j2", confirmations: 0 }, NOW, newId)).ok).toBe(true);
  });

  it("refuses a move the status machine does not allow and records each allowed move and note", async () => {
    const newId = ids("a");
    const bookmark = await repository.start({ jobId: "j3", confirmations: 0 }, NOW, newId);
    if (!bookmark.ok) throw new Error("expected a start");
    const id = bookmark.application.id;

    expect(await repository.update({ applicationId: id, status: "accepted" }, NOW, newId)).toEqual({
      ok: false,
      code: "invalid-transition",
    });
    expect(
      await repository.update({ applicationId: "missing", status: "ready" }, NOW, newId),
    ).toEqual({
      ok: false,
      code: "not-found",
    });

    const moved = await repository.update(
      { applicationId: id, status: "ready", note: "CV sent to recruiter" },
      NOW + 10,
      newId,
    );
    expect(moved.ok).toBe(true);
    const noted = await repository.update({ applicationId: id, note: "Waiting" }, NOW + 20, newId);
    expect(noted.ok && noted.application.status).toBe("ready");
    expect(noted.ok && noted.application.events.map((event) => [event.status, event.note])).toEqual(
      [
        ["bookmarked", null],
        ["preparing", null],
        ["ready", "CV sent to recruiter"],
        ["ready", "Waiting"],
      ],
    );
  });

  it("hides applications that were submitted or ended with the hide-applied filter, and not those still in progress", async () => {
    const newId = ids("a");
    const started = await repository.start({ jobId: "j1", confirmations: 0 }, NOW, newId);
    if (!started.ok) throw new Error("expected a start");
    await repository.update({ applicationId: started.application.id, status: "ready" }, NOW, newId);
    const titles = async (filter: object) =>
      (await listing.listJobs({ filter: JobFilterSchema.parse(filter), sort: "affinity" }, NOW))
        .map((job) => job.title)
        .sort();

    expect(await titles({})).toContain("Backend Engineer");
    await repository.update(
      { applicationId: started.application.id, status: "applied" },
      NOW,
      newId,
    );
    expect(await titles({})).not.toContain("Backend Engineer");
    expect(await titles({ hideApplied: false })).toContain("Backend Engineer");
  });

  it("returns one application with its events oldest first, and every application for the export", async () => {
    const newId = ids("a");
    const started = await repository.start({ jobId: "j4", confirmations: 0 }, NOW, newId);
    if (!started.ok) throw new Error("expected a start");
    await repository.update(
      { applicationId: started.application.id, status: "ready", note: "Ready" },
      NOW + DAY,
      newId,
    );
    const detail = await repository.detail(started.application.id);
    expect(detail?.events.map((event) => event.at)).toEqual([NOW, NOW + 1, NOW + DAY]);
    expect(await repository.detail("missing")).toBeNull();
    const details = await repository.listDetails();
    expect(details.map((item) => item.companyName)).toEqual(["Beta"]);
    expect(details[0]?.events).toHaveLength(3);
  });

  it("deletes an unsent application with its notes and documents, and refuses a sent one", async () => {
    // protects=an application that was not submitted is deleted with its events and documents and the cleanup hook runs, while a submitted one and an unknown id are refused and kept; fails_when=a sent application is deleted, documents or events stay behind, or the cleanup does not run; no_claim=the PDF files themselves, which the hook removes in main;
    const newId = ids("a");
    const removed: string[] = [];
    repository = createApplicationRepository(database.db, async (id) => {
      removed.push(id);
    });
    const open = await repository.start({ jobId: "j1", confirmations: 0 }, NOW, newId);
    const sent = await repository.start({ jobId: "j4", confirmations: 0 }, NOW, newId);
    if (!open.ok || !sent.ok) throw new Error("expected starts");
    await database.db.insert(applicationDocuments).values({
      applicationId: open.application.id,
      kind: "cv",
      content: "{}",
      language: "en",
      updatedAt: NOW,
      exportedAt: null,
    });
    await repository.update({ applicationId: sent.application.id, status: "ready" }, NOW, newId);
    await repository.update({ applicationId: sent.application.id, status: "applied" }, NOW, newId);

    expect(await repository.remove(open.application.id)).toEqual({ ok: true });
    expect(removed).toEqual([open.application.id]);
    expect(await repository.detail(open.application.id)).toBeNull();
    expect(await database.db.select().from(applicationDocuments)).toEqual([]);

    expect(await repository.remove(sent.application.id)).toEqual({
      ok: false,
      code: "already-sent",
    });
    expect(await repository.detail(sent.application.id)).not.toBeNull();
    expect(await repository.remove("missing")).toEqual({ ok: false, code: "not-found" });
  });
});
