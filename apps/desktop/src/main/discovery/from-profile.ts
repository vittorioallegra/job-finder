import type {
  CompanyAddRequest,
  CompanyAddResult,
  DiscoverySearchRequest,
  DiscoverySearchResult,
  IngestStartResult,
  JobPreferences,
  ProfileDiscoveryResult,
} from "@job-finder/bridge";

/** The search request takes at most this many keywords and places. */
const MAX_TERMS = 5;

export interface ProfileDiscoveryDeps {
  /** The saved preferences, or null before a profile exists. */
  preferences(): Promise<JobPreferences | null>;
  search(request: DiscoverySearchRequest): Promise<DiscoverySearchResult>;
  addCompany(input: CompanyAddRequest): Promise<CompanyAddResult>;
  /** Scans every company; called only when this search added one. */
  startRun(): Promise<IngestStartResult>;
}

export interface ProfileDiscovery {
  /**
   * Searches for the boards of companies hiring for the profile's roles in its places, adds the
   * ones not added yet, and starts a scan when it added any (unless `scan` is false, for a caller
   * that scans next anyway). A board already in the list is skipped.
   */
  run(options?: { scan?: boolean }): Promise<ProfileDiscoveryResult>;
}

/** The search terms a profile's preferences give: its roles as keywords, its places as places. */
export function discoveryRequestFor(preferences: JobPreferences): DiscoverySearchRequest | null {
  const keywords = preferences.roles.slice(0, MAX_TERMS);
  if (keywords.length === 0) return null;
  return { keywords, locations: preferences.locations.slice(0, MAX_TERMS) };
}

export function createProfileDiscovery(deps: ProfileDiscoveryDeps): ProfileDiscovery {
  return {
    async run(options = {}) {
      const preferences = await deps.preferences();
      const request = preferences === null ? null : discoveryRequestFor(preferences);
      if (request === null) return { ok: false, code: "no-roles" };
      const result = await deps.search(request);
      if (!result.ok) return { ok: false, code: result.code };
      let added = 0;
      for (const candidate of result.candidates) {
        const outcome = await deps.addCompany({
          name: candidate.name,
          careersUrl: candidate.careersUrl,
        });
        if (outcome.ok) added += 1;
      }
      const runStarted = added > 0 && options.scan !== false && (await deps.startRun()).ok;
      return {
        ok: true,
        found: result.candidates.length,
        added,
        runStarted,
        ...(result.searchBlocked ? { searchBlocked: true as const } : {}),
      };
    },
  };
}
