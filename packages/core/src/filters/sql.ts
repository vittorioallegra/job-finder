import { and, inArray, sql, type SQL } from "drizzle-orm";
import { applications, companies, jobFlags, jobs } from "../db/schema";
import { APPLIED_STATUSES } from "../applications/status";
import { foldForMatch } from "../normalize/text";
import { remoteScopeTerms, resolvePlace } from "../normalize/geo";
import type { JobFilter } from "./schema";

/** Escapes LIKE wildcards so a place matches its own characters only. */
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

/**
 * Words that name the same kind of work, in English and Italian: a role written with one matches a
 * title written with another ("Software Engineer" finds "Sviluppatore Software" and "Software
 * Developer"). Each group is interchangeable inside a role.
 */
const SAME_WORK: readonly (readonly string[])[] = [
  [
    "engineer",
    "developer",
    "programmer",
    "dev",
    "sviluppatore",
    "sviluppatrice",
    "programmatore",
    "programmatrice",
  ],
];

/** The words that count for one term of a role: the term itself and the words that mean the same. */
export function termAlternatives(word: string): readonly string[] {
  return SAME_WORK.find((group) => group.includes(word)) ?? [word];
}

/** The title as `roleTitleTerms` compares it: lower case, with hyphens and spaces removed. */
const comparableTitle = sql`replace(replace(replace(lower(${jobs.title}), '-', ''), ' ', ''), '/', '')`;

/** The remote scope as `placeCondition` compares it: lower case, punctuation as spaces, padded. */
const comparableScope = sql`(' ' || ${["-", "/", ",", "(", ")", ";", ":", "|", ".", "&"].reduce(
  (expression, char) => sql`replace(${expression}, ${char}, ' ')`,
  sql`lower(${jobs.remoteScope})`,
)} || ' ')`;

/** The home country of a job's company, or null when it is not known. */
const companyCountry = sql`(select ${companies.country} from ${companies} where ${companies.id} = ${jobs.companyId})`;

/** Words that only repeat the work mode, which has its own filter. */
const MODE_WORDS = new Set(["remote", "remoto", "remota", "hybrid", "ibrido", "onsite"]);

/**
 * The places condition (see `JobFilter.places`). Countries and areas match a location's country
 * code, or a remote scope that reaches them, and the job's company must be based there too ("Italy"
 * means Italian companies; a company whose country is not known is left out). Other text matches
 * the city, region or location text. Without a country to judge by, a remote job is kept: a posting
 * that does not say is not a no.
 */
function placeCondition(places: readonly string[]): SQL | undefined {
  const countries = new Set<string>();
  const cities: string[] = [];
  for (const place of places) {
    if (MODE_WORDS.has(foldForMatch(place))) continue;
    const resolved = resolvePlace(place);
    if (resolved.kind === "countries") resolved.codes.forEach((code) => countries.add(code));
    else if (resolved.text !== "") cities.push(resolved.text);
  }
  if (countries.size === 0 && cities.length === 0) return undefined;

  const options: SQL[] = [];
  if (cities.length > 0) {
    const anyCity = cities.map((city) => {
      const pattern = likePattern(city);
      return sql`(json_extract(loc.value, '$.raw') like ${pattern} escape '\\'
        or json_extract(loc.value, '$.city') like ${pattern} escape '\\'
        or json_extract(loc.value, '$.region') like ${pattern} escape '\\')`;
    });
    options.push(
      sql`exists (select 1 from json_each(${jobs.locations}) as loc where ${sql.join(anyCity, sql` or `)})`,
    );
  }
  if (countries.size > 0) {
    const codes = [...countries];
    const reaches: SQL[] = [];
    reaches.push(
      sql`exists (select 1 from json_each(${jobs.locations}) as loc where json_extract(loc.value, '$.countryCode') in (${sql.join(
        codes.map((code) => sql`${code}`),
        sql`, `,
      )}))`,
    );
    const terms = remoteScopeTerms(codes).map(
      (term) => sql`${comparableScope} like ${likePattern(` ${term} `)} escape '\\'`,
    );
    reaches.push(sql`(${jobs.remoteScope} is not null and (${sql.join(terms, sql` or `)}))`);
    reaches.push(
      sql`(${jobs.remoteScope} is null
        and not exists (select 1 from json_each(${jobs.locations}) as loc where json_extract(loc.value, '$.countryCode') is not null)
        and (${jobs.workMode} = 'remote' or json_array_length(${jobs.locations}) = 0))`,
    );
    const basedThere = sql`(${companyCountry} in (${sql.join(
      codes.map((code) => sql`${code}`),
      sql`, `,
    )}))`;
    options.push(sql`((${sql.join(reaches, sql` or `)}) and ${basedThere})`);
  } else {
    // Only cities are named: a remote job has no city to compare, so it stays.
    options.push(sql`${jobs.workMode} = 'remote'`);
  }
  return sql`(${sql.join(options, sql` or `)})`;
}

/**
 * The SQL condition of a filter on the `jobs` table, or undefined when the filter narrows nothing.
 * Flags are read through subqueries, so the condition can be added to any query over `jobs`.
 */
export function jobFilterCondition(filter: JobFilter): SQL | undefined {
  // Jobs of a company removed from the sources never show, whatever the filter.
  const parts: SQL[] = [
    sql`${jobs.companyId} not in (select ${companies.id} from ${companies} where ${companies.excludedAt} is not null)`,
  ];

  const roles = filter.roles.map(roleTitleTerms).filter((words) => words.length > 0);
  if (roles.length > 0) {
    const anyRole = roles.map(
      (words) =>
        sql`(${sql.join(
          words.map(
            (word) =>
              sql`(${sql.join(
                termAlternatives(word).map(
                  (same) => sql`${comparableTitle} like ${likePattern(same)} escape '\\'`,
                ),
                sql` or `,
              )})`,
          ),
          sql` and `,
        )})`,
    );
    parts.push(sql`(${sql.join(anyRole, sql` or `)})`);
  }

  const places = placeCondition(filter.places);
  if (places !== undefined) parts.push(places);

  if (filter.workModes.length > 0) parts.push(inArray(jobs.workMode, filter.workModes));
  if (filter.employmentTypes.length > 0) {
    parts.push(inArray(jobs.employmentType, filter.employmentTypes));
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
  return parts.length === 0 ? undefined : and(...parts);
}
