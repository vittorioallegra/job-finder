import { and, eq, inArray, notInArray, sql, type SQL } from "drizzle-orm";
import {
  applications,
  companies,
  jobFlags,
  jobScores,
  jobSources,
  jobs,
  profile,
} from "../db/schema";
import { APPLIED_STATUSES } from "../applications/status";
import { postedSince, type JobFilter } from "./schema";

/** Escapes LIKE wildcards so a keyword matches its own characters only. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Leading level words a role may carry; the title matches the role without them. */
const LEVEL_PREFIXES = new Set([
  "senior",
  "sr",
  "junior",
  "jr",
  "principal",
  "staff",
  "mid",
  "intern",
]);

/**
 * The words a job title must contain to match a role, lower case and without hyphens or spaces
 * inside words: "Senior Front-end Engineer" gives ["frontend", "engineer"], so "Frontend Engineer
 * (React)" and "Front End Engineer, Payments" both match. A leading level word is dropped, since
 * the level filter covers it; a role that is only a level word keeps it.
 */
export function roleTitleTerms(role: string): string[] {
  const words = role
    .toLowerCase()
    .replace(/[-_/]/g, "")
    .split(/[^\p{L}\p{N}+#.]+/u)
    .filter((word) => word !== "");
  let start = 0;
  while (start < words.length - 1 && LEVEL_PREFIXES.has(words[start] ?? "")) start += 1;
  return words.slice(start);
}

/** The title as `roleTitleTerms` compares it: lower case, with hyphens and spaces removed. */
const comparableTitle = sql`replace(replace(replace(lower(${jobs.title}), '-', ''), ' ', ''), '/', '')`;

/**
 * The SQL condition of a filter on the `jobs` table, or undefined when the filter narrows nothing.
 * `now` anchors the posted-within window. Flags, scores and sources are read through subqueries, so
 * the condition can be added to any query over `jobs`.
 */
export function jobFilterCondition(filter: JobFilter, now: number): SQL | undefined {
  // Jobs of a company removed from the sources never show, whatever the filter.
  const parts: SQL[] = [
    sql`${jobs.companyId} not in (select ${companies.id} from ${companies} where ${companies.excludedAt} is not null)`,
  ];

  const roles = filter.roles.map(roleTitleTerms).filter((words) => words.length > 0);
  if (roles.length > 0) {
    const anyRole = roles.map(
      (words) =>
        sql`(${sql.join(
          words.map((word) => sql`${comparableTitle} like ${likePattern(word)} escape '\\'`),
          sql` and `,
        )})`,
    );
    parts.push(sql`(${sql.join(anyRole, sql` or `)})`);
  }

  if (filter.keywords.length > 0) {
    const anyKeyword = filter.keywords.map((keyword) => {
      const pattern = likePattern(keyword);
      return sql`${jobs.title} like ${pattern} escape '\\' or ${jobs.description} like ${pattern} escape '\\'`;
    });
    parts.push(sql`(${sql.join(anyKeyword, sql` or `)})`);
  }
  for (const keyword of filter.excludedKeywords) {
    const pattern = likePattern(keyword);
    parts.push(
      sql`not (${jobs.title} like ${pattern} escape '\\' or ${jobs.description} like ${pattern} escape '\\')`,
    );
  }

  const location = filter.locationText === "" ? null : likePattern(filter.locationText);
  if (location !== null || filter.countryCode !== null) {
    const matchesText =
      location === null
        ? sql`1 = 1`
        : sql`(json_extract(loc.value, '$.raw') like ${location} escape '\\'
          or json_extract(loc.value, '$.city') like ${location} escape '\\'
          or json_extract(loc.value, '$.region') like ${location} escape '\\')`;
    const matchesCountry =
      filter.countryCode === null
        ? sql`1 = 1`
        : sql`json_extract(loc.value, '$.countryCode') = ${filter.countryCode}`;
    parts.push(
      sql`exists (select 1 from json_each(${jobs.locations}) as loc where ${matchesText} and ${matchesCountry})`,
    );
  }

  if (filter.remoteScope !== "") {
    parts.push(sql`${jobs.remoteScope} like ${likePattern(filter.remoteScope)} escape '\\'`);
  }
  if (filter.workModes.length > 0) parts.push(inArray(jobs.workMode, filter.workModes));
  if (filter.employmentTypes.length > 0) {
    parts.push(inArray(jobs.employmentType, filter.employmentTypes));
  }
  if (filter.seniorities.length > 0) parts.push(inArray(jobs.seniority, filter.seniorities));

  if (filter.salary !== null) {
    const { min, currency, period, hideWithoutSalary } = filter.salary;
    const comparable = sql`(${jobs.salary} is not null
      and json_extract(${jobs.salary}, '$.currency') is ${currency}
      and json_extract(${jobs.salary}, '$.period') is ${period})`;
    const meetsMinimum = sql`coalesce(json_extract(${jobs.salary}, '$.max'), json_extract(${jobs.salary}, '$.min'), 0) >= ${min}`;
    parts.push(
      hideWithoutSalary
        ? sql`(${comparable} and ${meetsMinimum})`
        : sql`(not ${comparable} or ${meetsMinimum})`,
    );
  }

  const since = postedSince(filter.postedWithin, now);
  if (since !== null) {
    parts.push(sql`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt}) >= ${since}`);
  }
  if (filter.language !== null) parts.push(eq(jobs.language, filter.language));
  if (filter.visaSponsorship !== null) {
    parts.push(eq(jobs.visaSponsorship, filter.visaSponsorship));
  }

  if (filter.includedCompanyIds.length > 0) {
    parts.push(inArray(jobs.companyId, filter.includedCompanyIds));
  }
  if (filter.excludedCompanyIds.length > 0) {
    parts.push(notInArray(jobs.companyId, filter.excludedCompanyIds));
  }
  if (filter.sources.length > 0) {
    parts.push(
      sql`exists (select 1 from ${jobSources} where ${jobSources.jobId} = ${jobs.id} and ${jobSources.closedAt} is null and ${inArray(jobSources.source, filter.sources)})`,
    );
  }

  if (filter.hideDismissed) {
    parts.push(
      sql`not exists (select 1 from ${jobFlags} where ${jobFlags.jobId} = ${jobs.id} and ${jobFlags.dismissedAt} is not null)`,
    );
  }
  if (filter.hideApplied) {
    parts.push(
      sql`not exists (select 1 from ${applications} where ${applications.jobId} = ${jobs.id} and ${inArray(applications.status, APPLIED_STATUSES)})`,
    );
  }
  if (filter.newOnly) {
    parts.push(
      sql`not exists (select 1 from ${jobFlags} where ${jobFlags.jobId} = ${jobs.id} and ${jobFlags.viewedAt} is not null)`,
    );
  }
  if (filter.minScore !== null) {
    parts.push(
      sql`exists (select 1 from ${jobScores} where ${jobScores.jobId} = ${jobs.id} and ${jobScores.profileVersion} = (select ${profile.version} from ${profile} where ${profile.id} = 1) and ${jobScores.score} >= ${filter.minScore})`,
    );
  }

  return parts.length === 0 ? undefined : and(...parts);
}
