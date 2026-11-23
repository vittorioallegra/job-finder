import {
  type AppStatus,
  applySettingsPatch,
  canTransition,
  type ApplicationDetail,
  type ApplicationStatus,
  type ApplicationSummary,
  DEFAULT_APP_SETTINGS,
  SECRET_NAMES,
  type AiTestResult,
  type AppSettings,
  type AppSettingsPatch,
  type CompanyRecord,
  type CvImportResult,
  type DiscoverySearchResult,
  type IngestEvent,
  type IngestStartResult,
  type JobFinderBridge,
  type JobDetail,
  type JobListItem,
  type LatestRun,
  type SavedSearch,
  JobFilterSchema,
  type Profile,
  ProfileSchema,
  type ProfileRecord,
  type SecretName,
  type SecretStorageInfo,
  type ScoreStartResult,
  type SecretsStatus,
} from "@job-finder/bridge";

export interface MemoryBridgeOptions {
  platform?: string;
  settings?: AppSettings;
  storage?: SecretStorageInfo;
  /** Outcome of "test connection". Defaults to AI unavailable, since there is no engine here. */
  aiTest?: AiTestResult;
  /** Outcome of a CV import. Defaults to engine unavailable, since there is no engine here. */
  cvImport?: CvImportResult;
  /** A profile already saved before the page loads. Defaults to none (onboarding not done). */
  profile?: Profile;
  companies?: CompanyRecord[];
  jobs?: JobListItem[];
  savedSearches?: SavedSearch[];
  latestRun?: LatestRun | null;
  /** Answer to "start a run". Defaults to engine unavailable, since there is no engine here. */
  ingestStart?: IngestStartResult;
  appStatus?: AppStatus;
  /** Outcome of a scoring run. Defaults to engine unavailable, since there is no engine here. */
  scoring?: ScoreStartResult;
  /** Answer to a discovery search. Defaults to engine unavailable, since there is no engine here. */
  discovery?: DiscoverySearchResult;
}

/**
 * In-memory stand-in for `window.jobFinder`: used by web tests and by `pnpm dev`, where the page
 * runs without the desktop preload. Nothing is persisted and secret values are never kept.
 */
export function createMemoryBridge(options: MemoryBridgeOptions = {}): JobFinderBridge {
  let settings: AppSettings = structuredClone(options.settings ?? DEFAULT_APP_SETTINGS);
  const storage: SecretStorageInfo = options.storage ?? { mode: "encrypted", optInRequired: false };
  const keys = Object.fromEntries(SECRET_NAMES.map((name) => [name, false])) as Record<
    SecretName,
    boolean
  >;

  const status = async (): Promise<SecretsStatus> => ({ storage, keys: { ...keys } });
  const companies: CompanyRecord[] = structuredClone(options.companies ?? []);
  const jobs: JobListItem[] = structuredClone(options.jobs ?? []);
  const savedSearches: SavedSearch[] = structuredClone(options.savedSearches ?? []);
  // Applications live only in this page: a bookmark, a preparation and status moves, no engine involved.
  const applicationList: ApplicationSummary[] = [];
  const progressListeners = new Set<(event: IngestEvent) => void>();
  let profile: ProfileRecord | null = options.profile
    ? { profile: options.profile, version: 1, updatedAt: 0 }
    : null;

  return {
    platform: options.platform ?? "darwin",
    settings: {
      get: async () => structuredClone(settings),
      update: async (patch: AppSettingsPatch) => {
        settings = applySettingsPatch(settings, patch);
        return structuredClone(settings);
      },
    },
    secrets: {
      status,
      set: async (name) => {
        keys[name] = true;
        return status();
      },
      clear: async (name) => {
        keys[name] = false;
        return status();
      },
    },
    ai: {
      testConnection: async () =>
        structuredClone(options.aiTest ?? { ok: false, code: "engine-unavailable" }),
    },
    profile: {
      get: async () => (profile ? structuredClone(profile) : null),
      save: async (input) => {
        const parsed = ProfileSchema.parse(input);
        const version =
          profile && JSON.stringify(profile.profile) === JSON.stringify(parsed)
            ? profile.version
            : (profile?.version ?? 0) + 1;
        profile = { profile: parsed, version, updatedAt: Date.now() };
        return structuredClone(profile);
      },
      importCv: async () =>
        structuredClone(options.cvImport ?? { ok: false, code: "engine-unavailable" }),
    },
    companies: {
      list: async () => structuredClone(companies),
      // No ATS detection here: the company is stored without a board, so it cannot be scanned.
      add: async (input) => {
        const company: CompanyRecord = {
          id: `memory-${companies.length + 1}`,
          name: input.name,
          careersUrl: input.careersUrl,
          ats: null,
          slug: null,
          createdAt: Date.now(),
          lastScan: null,
        };
        companies.push(company);
        return { ok: true, company: structuredClone(company) };
      },
    },
    // No filtering here: the list returns the jobs it was given, in their given order.
    jobs: {
      list: async () => structuredClone(jobs),
      detail: async ({ jobId }) => {
        const job = jobs.find((item) => item.id === jobId);
        if (!job) return null;
        const detail: JobDetail = {
          ...structuredClone(job),
          description: "",
          employmentType: "unknown",
          seniority: "unknown",
          salary: null,
          visaSponsorship: "unknown",
          language: null,
          remoteScope: null,
          closedAt: null,
          sources: [],
        };
        return detail;
      },
      flag: async ({ jobId, dismissed, viewed }) => {
        const job = jobs.find((item) => item.id === jobId);
        if (!job) return false;
        if (dismissed !== undefined) job.dismissed = dismissed;
        if (viewed !== undefined) job.isNew = !viewed;
        return true;
      },
    },
    applications: {
      list: async () => structuredClone(applicationList),
      detail: async ({ applicationId }) => {
        const found = applicationList.find((item) => item.id === applicationId);
        if (!found) return null;
        const detail: ApplicationDetail = { ...structuredClone(found), events: [] };
        return detail;
      },
      bookmark: async ({ jobId, bookmarked }) => {
        const job = jobs.find((item) => item.id === jobId);
        if (!job) return false;
        const at = applicationList.findIndex(
          (item) => item.jobId === jobId && item.status === "bookmarked",
        );
        if (bookmarked && at < 0 && !applicationList.some((item) => item.jobId === jobId)) {
          applicationList.push(summaryFor(job, "bookmarked"));
        } else if (!bookmarked && at >= 0) {
          applicationList.splice(at, 1);
        }
        return true;
      },
      check: async () => ({ sameJob: [], sameCompany: [], requiredConfirmations: 0 as const }),
      start: async ({ jobId }) => {
        const job = jobs.find((item) => item.id === jobId);
        if (!job) return { ok: false as const, code: "job-not-found" as const };
        const existing = applicationList.find((item) => item.jobId === jobId);
        const summary = existing ?? summaryFor(job, "preparing");
        if (existing && existing.status === "bookmarked") {
          existing.status = "preparing";
          existing.statusChangedAt = Date.now();
        } else if (!existing) {
          applicationList.push(summary);
        }
        return {
          ok: true as const,
          application: { ...structuredClone(summary), events: [] },
        };
      },
      update: async ({ applicationId, status }) => {
        const found = applicationList.find((item) => item.id === applicationId);
        if (!found) return { ok: false as const, code: "not-found" as const };
        if (status !== undefined && status !== found.status) {
          if (!canTransition(found.status, status as ApplicationStatus)) {
            return { ok: false as const, code: "invalid-transition" as const };
          }
          found.status = status as ApplicationStatus;
          found.statusChangedAt = Date.now();
        }
        return { ok: true as const, application: { ...structuredClone(found), events: [] } };
      },
      exportCsv: async () => ({ ok: false as const, code: "cancelled" as const }),
    },
    savedSearches: {
      list: async () => structuredClone(savedSearches),
      save: async (request) => {
        const filter = JobFilterSchema.parse(request.filter);
        if (request.id !== undefined) {
          const existing = savedSearches.find((item) => item.id === request.id);
          if (!existing) return null;
          existing.name = request.name;
          existing.filter = filter;
          existing.updatedAt = Date.now();
          return structuredClone(existing);
        }
        const created: SavedSearch = {
          id: `memory-search-${savedSearches.length + 1}`,
          name: request.name,
          filter,
          updatedAt: Date.now(),
        };
        savedSearches.push(created);
        return structuredClone(created);
      },
      delete: async ({ id }) => {
        const at = savedSearches.findIndex((item) => item.id === id);
        if (at >= 0) savedSearches.splice(at, 1);
      },
    },
    autofill: {
      start: async () => ({ ok: false as const, code: "autofill-failed" as const }),
    },
    documents: {
      get: async ({ applicationId }) => ({
        applicationId,
        cv: null,
        coverLetter: null,
        defaultLanguage: { language: "en" as const, source: "ui" as const },
      }),
      generate: async () => ({ ok: false as const, code: "engine-unavailable" as const }),
      save: async () => ({ ok: false as const, code: "not-found" as const }),
      exportPdf: async () => ({ ok: false as const, code: "export-failed" as const }),
      reveal: async () => false,
    },
    scores: {
      start: async () =>
        structuredClone(options.scoring ?? { ok: false, code: "engine-unavailable" }),
    },
    discovery: {
      search: async () =>
        structuredClone(options.discovery ?? { ok: false, code: "engine-unavailable" }),
    },
    app: {
      status: async () => structuredClone(options.appStatus ?? { engine: "running", update: null }),
      onStatusChange: () => () => {},
      // The page has no release to open and no notification to receive.
      openUpdate: async () => false,
      takePendingOpen: async () => null,
      onOpenNewJobs: () => () => {},
    },
    ingest: {
      start: async () =>
        structuredClone(options.ingestStart ?? { ok: false, code: "engine-unavailable" }),
      cancel: async () => {},
      latest: async () => structuredClone(options.latestRun ?? null),
      onProgress: (listener) => {
        progressListeners.add(listener);
        return () => {
          progressListeners.delete(listener);
        };
      },
    },
  };
}

function summaryFor(job: JobListItem, status: ApplicationStatus): ApplicationSummary {
  const now = Date.now();
  return {
    id: `memory-application-${now}-${Math.random().toString(36).slice(2, 8)}`,
    jobId: job.id,
    jobTitle: job.title,
    companyId: "",
    companyName: job.companyName,
    status,
    createdAt: now,
    statusChangedAt: now,
    jobUrl: job.url,
    applyUrl: job.applyUrl,
  };
}
