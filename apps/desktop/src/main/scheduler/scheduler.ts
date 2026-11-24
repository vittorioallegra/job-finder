import type { IngestRunOutcome } from "@job-finder/core/ingest/events";
import type { NewJobMatches } from "./matches";

export const MS_PER_HOUR = 60 * 60 * 1000;

/** The settings the scheduler reads each time it checks, so a change takes effect at the next check. */
export interface SchedulerSettings {
  intervalHours: number;
  notificationsEnabled: boolean;
}

export type StartOutcome =
  { ok: true; runId: string } | { ok: false; code: "already-running" | "engine-unavailable" };

export interface SchedulerDeps {
  now: () => number;
  settings: () => Promise<SchedulerSettings>;
  /** Whether the profile says what to look for (at least one role). */
  hasPreferences: () => Promise<boolean>;
  /** Adds the companies the profile's preferences point to, without scanning; the run follows. */
  discover: () => Promise<void>;
  /** When the last ingestion run that ended, however it ended; null before any run. */
  lastRunFinishedAt: () => Promise<number | null>;
  /** Starts an ingestion run over every company through the ingestion service. */
  startRun: () => Promise<StartOutcome>;
  /** The new jobs of a run that started at `since`, matched against the profile. */
  newMatches: (since: number) => Promise<NewJobMatches>;
  /** Shows one notification for a run with new matches. */
  notify: (matches: NewJobMatches) => void;
  log: (level: "info" | "warn" | "error", message: string) => void;
}

export interface Scheduler {
  /**
   * Starts a run when the profile says what to look for and the interval has passed since the last
   * run (or none ran). It first adds the companies the preferences point to.
   */
  check(): Promise<void>;
  /** Starts a run now, for the tray's "Search now". */
  runNow(): Promise<StartOutcome>;
  /**
   * An ingestion run ended. A run this scheduler started that found new matches is notified once;
   * any other run is ignored.
   */
  handleRunFinished(runId: string, status: IngestRunOutcome | "interrupted"): Promise<void>;
}

/**
 * Runs the profile's search on a schedule. The clock, the stores and the ingestion are injected, so the
 * tests drive time without timers. A run started here notifies only when it has new matches.
 */
export function createScheduler(deps: SchedulerDeps): Scheduler {
  let pending: { runId: string; startedAt: number } | null = null;

  async function start(): Promise<StartOutcome> {
    if (pending) return { ok: false, code: "already-running" };
    const startedAt = deps.now();
    const outcome = await deps.startRun();
    if (outcome.ok) pending = { runId: outcome.runId, startedAt };
    return outcome;
  }

  return {
    async check() {
      try {
        if (pending) return;
        if (!(await deps.hasPreferences())) return;
        const { intervalHours } = await deps.settings();
        const last = await deps.lastRunFinishedAt();
        const due = last === null || deps.now() - last >= intervalHours * MS_PER_HOUR;
        if (!due) return;
        // New companies first, so the run that follows scans them too. A failed search still scans.
        await deps.discover().catch((error: unknown) => {
          deps.log("warn", `company search before the scheduled run failed: ${String(error)}`);
        });
        const outcome = await start();
        if (!outcome.ok && outcome.code === "engine-unavailable") {
          deps.log("warn", "scheduled run not started: engine unavailable");
        }
      } catch (error) {
        deps.log("error", `scheduler check failed: ${String(error)}`);
      }
    },

    runNow() {
      return start();
    },

    async handleRunFinished(runId, _status) {
      if (!pending || pending.runId !== runId) return;
      const { startedAt } = pending;
      pending = null;
      try {
        const settings = await deps.settings();
        if (!settings.notificationsEnabled) return;
        const matches = await deps.newMatches(startedAt);
        if (matches.count === 0) return;
        deps.notify(matches);
      } catch (error) {
        deps.log("error", `scheduler notification failed: ${String(error)}`);
      }
    },
  };
}
