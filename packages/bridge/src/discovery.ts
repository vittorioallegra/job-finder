import { z } from "zod";
import type { DiscoveryCandidate, DiscoveryFailureCode } from "@job-finder/core/discovery/types";

export type { DiscoveryCandidate, DiscoveryFailureCode };

const TermSchema = z.string().trim().min(1).max(100);

/** Keywords are required; locations are optional. Both are sent as typed, never as a URL. */
export const DiscoverySearchRequestSchema = z.strictObject({
  keywords: z.array(TermSchema).min(1).max(5),
  locations: z.array(TermSchema).max(5),
});

export type DiscoverySearchRequest = z.input<typeof DiscoverySearchRequestSchema>;

/** Why a search gave no result: the provider blocked it, it failed, or the engine was unreachable. */
export type DiscoverySearchFailureCode = DiscoveryFailureCode | "engine-unavailable";

/**
 * The search for companies from the profile's "what you are looking for": `found` boards matched,
 * `added` of them were new, and a scan started when any was. `no-roles`: the profile has no role yet.
 */
export type ProfileDiscoveryResult =
  | { ok: true; found: number; added: number; runStarted: boolean; searchBlocked?: true }
  | { ok: false; code: DiscoverySearchFailureCode | "no-roles" };

/** `searchBlocked`: keyless search was refused, but the other sources still gave boards. */
export type DiscoverySearchResult =
  | { ok: true; candidates: DiscoveryCandidate[]; searchBlocked?: true }
  | { ok: false; code: DiscoverySearchFailureCode };

/**
 * The background reading of job directories and board lists that follows a profile search:
 * whether it runs, what it reads now, and how many postings it has stored (this run, or the last).
 */
export interface BackgroundReadStatus {
  running: boolean;
  phase: "postings" | "boards" | null;
  stored: number;
}
