// protects=a company's country is the country where most of its open jobs are located (ties to the lower code, closed jobs and jobs without a country not counted), else the country of its own web address, and none otherwise; stored locations that name only a city get their country from the text;
// fails_when=a closed job counts, a job without a country counts, the most common country is not chosen, a .io address gives a country, a company with no clue gets one, a city-only location stays without a country, or a second run changes the result;
// no_claim=how the countries of locations are first read from postings, which the normalizer tests cover;
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { companies, jobs } from "@job-finder/core";
import { openAppDatabase, type AppDatabase } from "./database";
import { backfillLocationCountries, refreshCompanyCountries } from "./company-country";

const repoMigrations = resolve(__dirname, "../../../drizzle");

describe("company country", () => {
  let database: AppDatabase;

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), "job-finder-company-country-"));
    database = await openAppDatabase({
      file: join(dir, "job-finder.sqlite"),
      migrationsFolder: repoMigrations,
      backupDirectory: join(dir, "backups"),
    });
    await database.db.insert(companies).values(
      ["it", "tie", "none", "closed"].map((id, index) => ({
        id,
        name: id,
        careersUrl: `https://${id}.test`,
        ats: null,
        slug: null,
        createdAt: index,
      })),
    );
  });

  afterEach(() => {
    database.close();
  });

  const job = (
    id: string,
    companyId: string,
    locations: Array<{ raw: string; countryCode?: string }>,
    closedAt: number | null = null,
  ) => ({
    id,
    companyId,
    fingerprint: `fp-${id}`,
    title: "Engineer",
    description: "Text",
    url: `https://x.test/${id}`,
    applyUrl: `https://x.test/${id}/apply`,
    locations: JSON.stringify(locations),
    workMode: "unknown",
    employmentType: "unknown",
    seniority: "unknown",
    visaSponsorship: "unknown",
    firstSeenAt: 1,
    lastSeenAt: 1,
    closedAt,
  });

  it("is the country of most of the open located jobs, and none when no job names one", async () => {
    await database.db.insert(jobs).values([
      job("a1", "it", [{ raw: "Milan", countryCode: "IT" }]),
      job("a2", "it", [{ raw: "Rome", countryCode: "IT" }]),
      job("a3", "it", [{ raw: "Berlin", countryCode: "DE" }]),
      job("b1", "tie", [{ raw: "Paris", countryCode: "FR" }]),
      job("b2", "tie", [{ raw: "Berlin", countryCode: "DE" }]),
      job("c1", "none", [{ raw: "Remote" }]),
      // Closed jobs do not count: only the open German one decides.
      job("d1", "closed", [{ raw: "Milan", countryCode: "IT" }], 5),
      job("d2", "closed", [{ raw: "Milan", countryCode: "IT" }], 5),
      job("d3", "closed", [{ raw: "Berlin", countryCode: "DE" }]),
    ]);

    await refreshCompanyCountries(database.db);
    await refreshCompanyCountries(database.db);

    const rows = await database.db
      .select({ id: companies.id, country: companies.country })
      .from(companies);
    expect(Object.fromEntries(rows.map((row) => [row.id, row.country]))).toEqual({
      it: "IT",
      tie: "DE",
      none: null,
      closed: "DE",
    });
  });

  it("reads the country of a company's own web address when its jobs name none, and ignores fashionable domains", async () => {
    await database.db.insert(companies).values([
      {
        id: "tld-it",
        name: "Azienda",
        careersUrl: "https://azienda.it/lavora",
        ats: null,
        slug: null,
        createdAt: 10,
      },
      {
        id: "tld-io",
        name: "Startup",
        careersUrl: "https://startup.io/jobs",
        ats: null,
        slug: null,
        createdAt: 11,
      },
      {
        id: "tld-uk",
        name: "Firm",
        careersUrl: "https://firm.co.uk/careers",
        ats: null,
        slug: null,
        createdAt: 12,
      },
    ]);
    // The jobs of the first name no country; its web address says Italy.
    await database.db.insert(jobs).values(job("t1", "tld-it", [{ raw: "Remote" }]));

    await refreshCompanyCountries(database.db);

    const rows = await database.db
      .select({ id: companies.id, country: companies.country })
      .from(companies);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row.country]));
    expect(byId["tld-it"]).toBe("IT");
    expect(byId["tld-io"]).toBeNull();
    expect(byId["tld-uk"]).toBe("GB");
  });

  it("gives stored locations their country from the text, so a company that wrote only Milano is Italian", async () => {
    await database.db
      .insert(jobs)
      .values([
        job("m1", "it", [{ raw: "Milano" }]),
        job("m2", "it", [{ raw: "Roma, Lazio" }]),
        job("m3", "none", [{ raw: "Remote" }]),
      ]);

    expect(await backfillLocationCountries(database.db)).toBe(2);
    expect(await backfillLocationCountries(database.db)).toBe(0);
    await refreshCompanyCountries(database.db);

    const rows = await database.db
      .select({ id: companies.id, country: companies.country })
      .from(companies);
    expect(Object.fromEntries(rows.map((row) => [row.id, row.country]))).toMatchObject({
      it: "IT",
      none: null,
    });
  });
});
