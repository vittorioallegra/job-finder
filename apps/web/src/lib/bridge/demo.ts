import { demoDataset } from "@job-finder/bridge/demo";
import type { MemoryBridgeOptions } from "./memory";

/** The in-memory bridge filled with the shared sample data, for `pnpm dev` with `?demo`. */
export function demoBridgeOptions(now: number = Date.now()): MemoryBridgeOptions {
  return {
    ...demoDataset(now),
    scoring: { ok: true, scored: 3, cached: 6, failed: 0, skipped: 0 },
  };
}
