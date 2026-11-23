import type { DiscoveryCriteria, DiscoveryOutcome } from "@job-finder/core/discovery/types";
import type { DiscoverySearchRequest, DiscoverySearchResult } from "@job-finder/bridge";
import { EngineUnavailableError } from "../engine/supervisor";

/** The engine side of a discovery search, as seen from main. */
export interface DiscoveryEngine {
  discoverCompanies(criteria: DiscoveryCriteria): Promise<DiscoveryOutcome>;
}

export interface DiscoveryService {
  /** Searches the web for ATS boards. Found boards are only returned; the renderer adds the ones the user picks. */
  search(request: DiscoverySearchRequest): Promise<DiscoverySearchResult>;
}

/** Relays a search to the engine, which makes the requests. No key is needed: the search is keyless. */
export function createDiscoveryService(engine: () => DiscoveryEngine | null): DiscoveryService {
  return {
    async search(request) {
      const current = engine();
      if (!current) {
        return { ok: false, code: "engine-unavailable" };
      }
      try {
        const outcome = await current.discoverCompanies({
          keywords: request.keywords,
          locations: request.locations,
        });
        return outcome.ok
          ? { ok: true, candidates: outcome.candidates }
          : { ok: false, code: outcome.code };
      } catch (error) {
        if (error instanceof EngineUnavailableError) {
          return { ok: false, code: "engine-unavailable" };
        }
        return { ok: false, code: "search-failed" };
      }
    },
  };
}
