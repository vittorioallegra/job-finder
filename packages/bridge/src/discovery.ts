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

/** `searchBlocked`: keyless search was refused, but the other sources still gave boards. */
export type DiscoverySearchResult =
  | { ok: true; candidates: DiscoveryCandidate[]; searchBlocked?: true }
  | { ok: false; code: DiscoverySearchFailureCode };
