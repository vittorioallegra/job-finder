// protects=the text read for the skills check comes from open jobs that pass the profile's filter only, newest first, within the limit, and the stored written review round-trips and a damaged row reads as none;
// fails_when=a closed job, a job outside the filter or an excluded company's job is read, the newest are not first, the limit is ignored, or a damaged review row throws;
// no_claim=which skills the texts name, which the core review tests cover;
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { companies, jobs, settings } from "@job-finder/core";
import { JobFilterSchema } from "@job-finder/core/filters";
import { openAppDatabase } from "./database";
import { marketJobTexts } from "./review-operations";
import { createProfileReviewStore } from "../profile/review-store";

async function database() {
  const dir = mkdtempSync(join(tmpdir(), "job-finder-review-"));
  return openAppDatabase({
    file: join(dir, "job-finder.sqlite"),
    migrationsFolder: resolve(__dirname, "../../../drizzle"),
    backupDirectory: join(dir, "backups"),
  });
}

const company = (id: string, excludedAt: number | null = null) => ({
  id,
  name: id,
  careersUrl: `https://${id}.example/careers`,
  ats: null,
  slug: null,
  createdAt: 1,
  country: "IT",
  origin: "discovery" as const,
  excludedAt,
});

const job = (
  id: string,
  companyId: string,
  title: string,
  seen: number,
  closedAt: number | null = null,
) => ({
  id,
  companyId,
  fingerprint: id,
  title,
  description: `About ${id}`,
  url: `https://x.test/${id}`,
  applyUrl: `https://x.test/${id}`,
  locations: JSON.stringify([{ raw: "Milano, Italy", countryCode: "IT" }]),
  workMode: "unknown",
  employmentType: "unknown",
  seniority: "unknown",
  visaSponsorship: "unknown",
  firstSeenAt: seen,
  lastSeenAt: seen,
  closedAt,
});

describe("market job texts", () => {
  it("reads open jobs of followed companies that pass the filter, newest first, within the limit", async () => {
    const { db, close } = await database();
    await db.insert(companies).values([company("acme"), company("gone", 5)]);
    await db
      .insert(jobs)
      .values([
        job("old", "acme", "Backend Engineer", 10),
        job("new", "acme", "Backend Engineer", 30),
        job("mid", "acme", "Backend Engineer", 20),
        job("closed", "acme", "Backend Engineer", 40, 50),
        job("other-role", "acme", "Pastry Chef", 35),
        job("excluded", "gone", "Backend Engineer", 45),
      ]);

    const all = await marketJobTexts(
      db,
      JobFilterSchema.parse({ roles: ["Backend Engineer"] }),
      10,
    );
    expect(all.map((text) => text.split("\n")[1])).toEqual(["About new", "About mid", "About old"]);
    expect(all[0]).toContain("Backend Engineer");
    expect(
      await marketJobTexts(db, JobFilterSchema.parse({ roles: ["Backend Engineer"] }), 2),
    ).toHaveLength(2);
    close();
  });
});

describe("profile review store", () => {
  it("keeps the review in one row, replaces it, and reads a damaged row as none", async () => {
    const { db, close } = await database();
    const store = createProfileReviewStore(db);
    expect(await store.get()).toBeNull();

    const first = {
      profileHash: "h1",
      language: "en",
      promptVersion: 1,
      createdAt: 5,
      review: { summary: "A", suggestions: [] },
    };
    await store.set(first);
    expect(await store.get()).toEqual(first);
    await store.set({ ...first, profileHash: "h2", createdAt: 6 });
    expect((await store.get())?.profileHash).toBe("h2");

    await db.update(settings).set({ value: "{not json" });
    expect(await store.get()).toBeNull();
    close();
  });
});
