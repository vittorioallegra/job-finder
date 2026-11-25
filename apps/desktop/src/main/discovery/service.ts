import type {
  DiscoveryCriteria,
  DiscoveryOutcome,
  KeyedSearchConfig,
  SearchSourceConfig,
} from "@job-finder/core/discovery/types";
import type { NormalizedJob } from "@job-finder/core/normalize";
import { WIDE_SLICE } from "@job-finder/core/discovery";
import type { DiscoverySearchRequest, DiscoverySearchResult, SecretName } from "@job-finder/bridge";
import { EngineUnavailableError } from "../engine/supervisor";
import type { SecretStore } from "../secrets/store";
import type { SettingsRepository } from "../settings/repository";

/** The engine side of a discovery search, as seen from main. */
export interface DiscoveryEngine {
  discoverCompanies(
    criteria: DiscoveryCriteria,
    config: SearchSourceConfig,
  ): Promise<DiscoveryOutcome>;
}

export interface DiscoveryService {
  /** Searches the web for ATS boards. Found boards are only returned; the renderer adds the ones the user picks. */
  search(request: DiscoverySearchRequest): Promise<DiscoverySearchResult>;
  /**
   * Reads the next slice of the community board lists and stores the postings in the request's
   * places. One at a time; a call while one runs does nothing. Never throws.
   */
  widen(request: DiscoverySearchRequest): Promise<void>;
}

export interface DiscoveryServiceOptions {
  engine: () => DiscoveryEngine | null;
  settings: Pick<SettingsRepository, "get">;
  secrets: Pick<SecretStore, "read">;
  /** Hosts of the companies already followed, so a search does not look them up again. */
  knownHosts?: () => Promise<string[]>;
  /** Stores the postings a job directory gave; they are never sent to the renderer. */
  storeJobs?: (jobs: NormalizedJob[]) => Promise<unknown>;
  /** Boards already followed, as "<ats>/<slug>". */
  knownBoards?: () => Promise<string[]>;
  /** Where the next wide scan slice starts, kept between runs. */
  wideCursor?: { get(): Promise<number>; set(value: number): Promise<void> };
  /** Boards found gone or empty lately: skipped, and filled in after each wide scan. */
  wideChecked?: {
    skip(): Promise<string[]>;
    record(entries: { board: string; kind: "dead" | "idle" }[]): Promise<void>;
  };
}

/** Each keyed provider reads its own secret; the name is fixed here, never taken from the renderer. */
const KEYED_SECRETS: Record<KeyedSearchConfig["provider"], SecretName> = {
  brave: "search.brave",
  tavily: "search.tavily",
  serper: "search.serper",
};

/**
 * Relays a search to the engine. The enabled sources come from settings; a keyed provider runs only
 * when its toggle is on and its key is saved. Keys are read here and handed only to the engine.
 */
export function createDiscoveryService(options: DiscoveryServiceOptions): DiscoveryService {
  let widening = false;
  return {
    async widen(request) {
      const current = options.engine();
      if (!current || widening || !options.storeJobs || !options.wideCursor) return;
      widening = true;
      try {
        // The postings of the job directories first, then the next slice of the board lists.
        const postings = await current.discoverCompanies(
          { keywords: request.keywords, locations: request.locations, postings: true },
          { duckduckgo: false, keyed: [] },
        );
        if (postings.ok && postings.jobs && postings.jobs.length > 0) {
          await options.storeJobs(postings.jobs);
        }
        const offset = await options.wideCursor.get();
        const knownBoards = options.knownBoards ? await options.knownBoards() : [];
        const outcome = await current.discoverCompanies(
          {
            keywords: request.keywords,
            locations: request.locations,
            wide: { offset, count: WIDE_SLICE },
            knownBoards,
            skipBoards: options.wideChecked ? await options.wideChecked.skip() : [],
          },
          { duckduckgo: false, keyed: [] },
        );
        if (!outcome.ok) return;
        if (outcome.jobs && outcome.jobs.length > 0) await options.storeJobs(outcome.jobs);
        if (outcome.wideChecked) await options.wideChecked?.record(outcome.wideChecked);
        if (outcome.wideNext !== undefined) await options.wideCursor.set(outcome.wideNext);
      } catch {
        // A failed wide scan only means no new postings this time.
      } finally {
        widening = false;
      }
    },
    async search(request) {
      const current = options.engine();
      if (!current) {
        return { ok: false, code: "engine-unavailable" };
      }
      try {
        const { search } = await options.settings.get();
        const keyed: KeyedSearchConfig[] = [];
        for (const provider of Object.keys(KEYED_SECRETS) as KeyedSearchConfig["provider"][]) {
          if (!search[provider]) continue;
          const apiKey = await options.secrets.read(KEYED_SECRETS[provider]);
          if (apiKey) keyed.push({ provider, apiKey });
        }
        // One service at a time: with a usable key, DuckDuckGo stays out (settings saved before
        // the choice became single may still have both switched on).
        const known = options.knownHosts ? await options.knownHosts() : [];
        const outcome = await current.discoverCompanies(
          { keywords: request.keywords, locations: request.locations, known },
          { duckduckgo: search.duckduckgo && keyed.length === 0, keyed },
        );
        if (!outcome.ok) return { ok: false, code: outcome.code };
        // The note about a blocked keyless search suggests adding a key: it is left out once a key
        // is in use, since the results then come from the keyed provider.
        return outcome.searchBlocked && keyed.length === 0
          ? { ok: true, candidates: outcome.candidates, searchBlocked: true }
          : { ok: true, candidates: outcome.candidates };
      } catch (error) {
        if (error instanceof EngineUnavailableError) {
          return { ok: false, code: "engine-unavailable" };
        }
        return { ok: false, code: "search-failed" };
      }
    },
  };
}
