// protects=postings a job directory gives are stored under one company per name that no screen lists or scans, stored again without duplicates, kept out for a company the user removed, and closed once the directory has not listed them for a month;
// fails_when=a posting is stored twice, a directory company shows in the company list or the scan list, a removed company gets jobs back, or a stale posting stays open;
// no_claim=the directory's real answers and the search that produced the postings: they are hand-made here;
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { companies, jobs } from "@job-finder/core";
import { eq } from "drizzle-orm";
import type { NormalizedJob } from "@job-finder/core/normalize";
import { openAppDatabase } from "../db/database";
import { listCompanyRows } from "../db/ingest-operations";
import { createIngestRepository } from "./repository";
import { createDirectoryJobStore } from "./directory-jobs";

async function database() {
  const dir = mkdtempSync(join(tmpdir(), "job-finder-directory-"));
  return openAppDatabase({
    file: join(dir, "job-finder.sqlite"),
    migrationsFolder: resolve(__dirname, "../../../drizzle"),
    backupDirectory: join(dir, "backups"),
  });
}

const posting = (company: string, id: string): NormalizedJob => ({
  source: "workable-directory",
  sourceJobId: id,
  url: `https://jobs.example.test/${id}`,
  applyUrl: `https://jobs.example.test/${id}`,
  companyName: company,
  title: `Engineer ${id}`,
  description: "Build things.",
  locations: [{ raw: "Milan, Italy", city: "Milan", countryCode: "IT" }],
  workMode: "unknown",
  employmentType: "unknown",
  seniority: "unknown",
  visaSponsorship: "unknown",
});

describe("directory job store", () => {
  it("stores postings under their companies once, and hides those companies from the lists", async () => {
    const { db, close } = await database();
    const store = createDirectoryJobStore(db);

    expect(
      await store.store([posting("Acme Srl", "1"), posting("Acme", "2"), posting("Beta", "3")]),
    ).toBe(3);
    await store.store([posting("Acme Srl", "1")]);

    expect(await db.select().from(jobs)).toHaveLength(3);
    expect(await db.select().from(companies)).toHaveLength(2);
    expect(await listCompanyRows(db)).toEqual([]);
    expect(await createIngestRepository(db).listCompanies()).toEqual([]);
    close();
  });

  it("leaves out a company the user removed", async () => {
    const { db, close } = await database();
    const store = createDirectoryJobStore(db);
    await store.store([posting("Acme", "1")]);
    await db.update(companies).set({ excludedAt: 1 });
    await store.store([posting("Acme", "2")]);

    expect(await db.select().from(jobs)).toHaveLength(1);
    close();
  });

  it("closes a posting the directory has not listed for a month", async () => {
    const { db, close } = await database();
    const day = 24 * 60 * 60 * 1000;
    await createDirectoryJobStore(db, () => 1_000).store([posting("Acme", "1")]);
    await createDirectoryJobStore(db, () => 1_000 + 40 * day).store([posting("Acme", "2")]);

    const rows = await db.select().from(jobs).where(eq(jobs.title, "Engineer 1"));
    expect(rows[0]?.closedAt).not.toBeNull();
    const open = await db.select().from(jobs).where(eq(jobs.title, "Engineer 2"));
    expect(open[0]?.closedAt).toBeNull();
    close();
  });

  it("remembers boards found gone for two months and empty for a week, and forgets them after", async () => {
    const { db, close } = await database();
    const day = 24 * 60 * 60 * 1000;
    let clock = 1_000;
    const store = createDirectoryJobStore(db, () => clock);
    await store.wideChecked.record([
      { board: "greenhouse/gone", kind: "dead" },
      { board: "greenhouse/empty", kind: "idle" },
    ]);

    expect((await store.wideChecked.skip()).sort()).toEqual([
      "greenhouse/empty",
      "greenhouse/gone",
    ]);
    clock += 8 * day;
    expect(await store.wideChecked.skip()).toEqual(["greenhouse/gone"]);
    clock += 60 * day;
    expect(await store.wideChecked.skip()).toEqual([]);
    close();
  });
});
