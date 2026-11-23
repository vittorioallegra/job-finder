import type { UpdateNotice } from "@job-finder/bridge";
import type { UpdateCheckOutcome } from "@job-finder/core/updates";

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** The part of the engine supervisor the update check needs. */
export interface UpdateEngine {
  checkForUpdate(currentVersion: string): Promise<UpdateCheckOutcome>;
}

export interface UpdateServiceOptions {
  /** The current engine, or null while none is running. */
  engine: () => UpdateEngine | null;
  currentVersion: string;
  /** Reads the setting each time, so turning the check off takes effect at once. */
  enabled: () => Promise<boolean>;
  now: () => number;
  intervalMs?: number;
  /** Called when the newer release changes (appears, changes or goes away). */
  onChange: (notice: UpdateNotice | null) => void;
  log: (level: "warn" | "error", message: string) => void;
}

export interface UpdateService {
  /** Asks now (when the check is enabled), whatever the last check was. */
  check(): Promise<void>;
  /** Asks when the check is enabled and the last attempt is a day old or more, or none was made. */
  checkIfDue(): Promise<void>;
  notice(): UpdateNotice | null;
}

/** Looks for a newer release through the engine, at most once a day, and reports it. */
export function createUpdateService(options: UpdateServiceOptions): UpdateService {
  const interval = options.intervalMs ?? UPDATE_CHECK_INTERVAL_MS;
  let notice: UpdateNotice | null = null;
  let lastAttemptAt: number | null = null;

  function setNotice(next: UpdateNotice | null): void {
    const same =
      notice === next ||
      (notice !== null &&
        next !== null &&
        notice.version === next.version &&
        notice.url === next.url);
    if (same) return;
    notice = next;
    options.onChange(next);
  }

  async function check(): Promise<void> {
    if (!(await options.enabled())) {
      setNotice(null);
      return;
    }
    const engine = options.engine();
    if (!engine) return;
    lastAttemptAt = options.now();
    let outcome: UpdateCheckOutcome;
    try {
      outcome = await engine.checkForUpdate(options.currentVersion);
    } catch {
      options.log("warn", "update check not run: engine unavailable");
      return;
    }
    if (!outcome.ok) {
      options.log("warn", `update check failed: ${outcome.code}`);
      return;
    }
    setNotice(
      outcome.release ? { version: outcome.release.version, url: outcome.release.url } : null,
    );
  }

  return {
    check,
    async checkIfDue() {
      if (lastAttemptAt !== null && options.now() - lastAttemptAt < interval) return;
      await check();
    },
    notice: () => notice,
  };
}
