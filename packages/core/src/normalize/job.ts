export const WORK_MODES = ["remote", "hybrid", "onsite", "unknown"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const EMPLOYMENT_TYPES = [
  "full_time",
  "part_time",
  "contract",
  "freelance",
  "internship",
  "temporary",
  "unknown",
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const SENIORITY_LEVELS = ["intern", "junior", "mid", "senior", "lead", "unknown"] as const;
export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number];

export const VISA_SPONSORSHIP_VALUES = ["yes", "no", "unknown"] as const;
export type VisaSponsorship = (typeof VISA_SPONSORSHIP_VALUES)[number];

export const SALARY_PERIODS = ["year", "month", "week", "day", "hour"] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

export interface JobLocation {
  /** The location as the source wrote it. */
  raw: string;
  city?: string;
  region?: string;
  /** ISO 3166-1 alpha-2, upper case. */
  countryCode?: string;
}

/** Only what the posting states. Currency is an ISO 4217 code. */
export interface Salary {
  min?: number;
  max?: number;
  currency?: string;
  period?: SalaryPeriod;
}

/**
 * A posting as read from one source. `source` is the ATS id for ATS postings and
 * `sourceJobId` is that source's own id: together they identify the job (see `identityKey`).
 */
export interface NormalizedJob {
  source: string;
  sourceJobId: string;
  /** Public posting page. */
  url: string;
  /** Where the application starts. */
  applyUrl: string;
  companyName: string;
  title: string;
  /** Plain text. Job HTML never goes into this field unchanged. */
  description: string;
  /** ISO 639-1 code when the description is recognisably in one language. */
  language?: string;
  locations: JobLocation[];
  workMode: WorkMode;
  /** Scope stated next to "remote", e.g. "EU" or "worldwide". */
  remoteScope?: string;
  employmentType: EmploymentType;
  seniority: SeniorityLevel;
  salary?: Salary;
  visaSponsorship: VisaSponsorship;
  /** ISO 8601 timestamp from the source. */
  postedAt?: string;
}

export interface JobIdentity {
  source: string;
  sourceJobId: string;
}

/** Key of a job within its source. Cross-source duplicates are found by fingerprint instead. */
export function identityKey(identity: JobIdentity): string {
  return `${identity.source}\u0000${identity.sourceJobId}`;
}
