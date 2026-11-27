// protects=a company a search added is dropped once scanned when it has no open job in the profile's places, a company added by hand, one not scanned yet, one with a job in the places, and a profile with no place all stay, and the count of companies with offers covers hidden ones too;
// fails_when=a directory company is left out of its list, listed out of name order, counted for jobs outside the places, or a scanned company shows in it, a hand-added company is dropped, a company is dropped before its first scan, a company with a job in the places is dropped, a profile with no place prunes anything, or a hidden directory company is left out of the count;
// no_claim=the scan itself and the places filter's own rules, which the core filter tests cover;
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { companies, jobs, runs } from "@job-finder/core";
import type { JobPreferences } from "@job-finder/bridge";
import { openAppDatabase } from "../db/database";
import { appendRunEvent } from "../db/ingest-operations";
import { companiesWithOffers, directoryCompanies, pruneOffProfileCompanies } from "./prune";

async function database() {
  const dir = mkdtempSync(join(tmpdir(), "job-finder-prune-"));
  return openAppDatabase({
    file: join(dir, "job-finder.sqlite"),
    migrationsFolder: resolve(__dirname, "../../../drizzle"),
    backupDirectory: join(dir, "backups"),
  });
}

const preferences = (locations: string[]): JobPreferences =>
  ({
    roles: ["Engineer"],
    locations,
    workModes: [],
    employmentTypes: [],
  }) as unknown as JobPreferences;

describe("pruning companies off the profile", () => {
  it("drops a scanned discovered company with no job in the places, and keeps the others", async () => {
    const { db, close } = await database();
    const company = (id: string, origin: "manual" | "discovery", country: string | null) => ({
      id,
      name: id,
      careersUrl: `https://${id}.example/careers`,
      ats: null,
      slug: null,
      createdAt: 1,
      country,
      origin,
    });
    await db
      .insert(companies)
      .values([
        company("far", "discovery", "US"),
        company("hand", "manual", "US"),
        company("fresh", "discovery", "US"),
        company("near", "discovery", "IT"),
      ]);
    await db.insert(jobs).values({
      id: "j1",
      companyId: "near",
      fingerprint: "f1",
      title: "Engineer",
      description: "",
      url: "https://x.test/1",
      applyUrl: "https://x.test/1",
      locations: JSON.stringify([{ raw: "Milan, Italy", countryCode: "IT" }]),
      workMode: "unknown",
      employmentType: "unknown",
      seniority: "unknown",
      visaSponsorship: "unknown",
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
    });
    await db.insert(runs).values({ id: "r1", kind: "ingest", status: "succeeded", startedAt: 1 });
    for (const [seq, id] of ["far", "hand", "near"].entries()) {
      await appendRunEvent(db, {
        runId: "r1",
        seq,
        at: 1,
        kind: "company-scanned",
        companyId: id,
        companyName: id,
        jobCount: 0,
        closedCount: 0,
      } as never);
    }

    expect(await pruneOffProfileCompanies(db, preferences([]))).toBe(0);
    expect(await pruneOffProfileCompanies(db, null)).toBe(0);
    expect(await pruneOffProfileCompanies(db, preferences(["Italia"]), 99)).toBe(1);

    const rows = await db.select().from(companies);
    expect(rows.filter((row) => row.excludedAt !== null).map((row) => row.id)).toEqual(["far"]);
    expect(await companiesWithOffers(db, preferences(["Italia"]))).toBe(1);
    close();
  });
});

describe("directory companies", () => {
  it("lists only the hidden directory companies with open jobs in the places, by name, with their count", async () => {
    const { db, close } = await database();
    const company = (id: string, name: string, careersUrl: string) => ({
      id,
      name,
      careersUrl,
      ats: null,
      slug: null,
      createdAt: 1,
      country: "IT",
      origin: "discovery" as const,
    });
    await db
      .insert(companies)
      .values([
        company("d-b", "pwc", "directory:pwc"),
        company("d-a", "Accenture", "directory:accenture"),
        company("d-far", "Faraway", "directory:faraway"),
        company("followed", "Followed", "https://followed.example/careers"),
      ]);
    const job = (id: string, companyId: string, country: string) => ({
      id,
      companyId,
      fingerprint: id,
      title: "Engineer",
      description: "",
      url: `https://x.test/${id}`,
      applyUrl: `https://x.test/${id}`,
      locations: JSON.stringify([{ raw: "Somewhere", countryCode: country }]),
      workMode: "unknown",
      employmentType: "unknown",
      seniority: "unknown",
      visaSponsorship: "unknown",
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
    });
    await db
      .insert(jobs)
      .values([
        job("a1", "d-a", "IT"),
        job("a2", "d-a", "IT"),
        job("b1", "d-b", "IT"),
        job("f1", "d-far", "US"),
        job("o1", "followed", "IT"),
      ]);

    expect(await directoryCompanies(db, preferences(["Italia"]), 99)).toEqual([
      { id: "d-a", name: "Accenture", country: "IT", openJobs: 2 },
      { id: "d-b", name: "pwc", country: "IT", openJobs: 1 },
    ]);
    close();
  });
});
