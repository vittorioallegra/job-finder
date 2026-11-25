import type {
  DiscoveryCriteria,
  DiscoveryOutcome,
  KeyedSearchConfig,
  SearchSourceConfig,
} from "@job-finder/core/discovery/types";
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
}

export interface DiscoveryServiceOptions {
  engine: () => DiscoveryEngine | null;
  settings: Pick<SettingsRepository, "get">;
  secrets: Pick<SecretStore, "read">;
  /** Hosts of the companies already followed, so a search does not look them up again. */
  knownHosts?: () => Promise<string[]>;
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
  return {
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
