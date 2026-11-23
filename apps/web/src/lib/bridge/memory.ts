import {
  applySettingsPatch,
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
  type JobListItem,
  type LatestRun,
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
  latestRun?: LatestRun | null;
  /** Answer to "start a run". Defaults to engine unavailable, since there is no engine here. */
  ingestStart?: IngestStartResult;
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
    jobs: {
      list: async () => structuredClone(jobs),
    },
    scores: {
      start: async () =>
        structuredClone(options.scoring ?? { ok: false, code: "engine-unavailable" }),
    },
    discovery: {
      search: async () =>
        structuredClone(options.discovery ?? { ok: false, code: "engine-unavailable" }),
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
