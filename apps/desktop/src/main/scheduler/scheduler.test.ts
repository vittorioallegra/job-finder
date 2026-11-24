// protects=scheduled runs start only with saved searches or profile preferences (finding new companies first) and once the interval has passed since the last finished run, a run never starts over an active one, and a run the scheduler started notifies once when it has new matches, with the click target of the matching search;
// fails_when=a run starts with no saved searches or before the interval, a second run starts over an active one, a run without new matches notifies, a run finished twice notifies twice, a run the scheduler did not start notifies, or a failing store throws out of a check;
// no_claim=the real clock, the powerMonitor wake events, the timer that calls check, and the ingestion run itself are not exercised here; the ingestion service and engine tests cover the run.
import { describe, expect, it } from "vitest";
import type { OpenNewJobsRequest, SavedSearch } from "@job-finder/bridge";
import { createScheduler, MS_PER_HOUR, type SchedulerDeps, type StartOutcome } from "./scheduler";
import type { NewJobMatches } from "./matches";

const search = (id: string, name: string): SavedSearch => ({
  id,
  name,
  filter: {} as SavedSearch["filter"],
  updatedAt: 0,
});

interface Fixture {
  deps: SchedulerDeps;
  clock: { now: number };
  searches: SavedSearch[];
  lastFinished: { at: number | null };
  starts: number;
  startAnswer: StartOutcome;
  matches: NewJobMatches;
  notified: Array<{ matches: NewJobMatches; open: OpenNewJobsRequest }>;
  logs: string[];
  preferences: boolean;
  /** What happened, in order: "discover" and "start". */
  order: string[];
}

function fixture(
  overrides: Partial<{ notifications: boolean; intervalHours: number }> = {},
): Fixture {
  const clock = { now: 10 * MS_PER_HOUR };
  const fx: Fixture = {
    deps: undefined as unknown as SchedulerDeps,
    clock,
    searches: [search("s1", "Backend Milan")],
    lastFinished: { at: null },
    starts: 0,
    startAnswer: { ok: true, runId: "run-1" },
    matches: { count: 2, topScore: 88, searchNames: ["Backend Milan"], savedSearchId: "s1" },
    notified: [],
    logs: [],
    preferences: false,
    order: [],
  };
  fx.deps = {
    now: () => clock.now,
    settings: async () => ({
      intervalHours: overrides.intervalHours ?? 24,
      notificationsEnabled: overrides.notifications ?? true,
    }),
    savedSearches: async () => fx.searches,
    hasPreferences: async () => fx.preferences,
    discover: async () => {
      fx.order.push("discover");
    },
    lastRunFinishedAt: async () => fx.lastFinished.at,
    startRun: async () => {
      fx.starts += 1;
      fx.order.push("start");
      return fx.startAnswer;
    },
    newMatches: async () => fx.matches,
    notify: (matches, open) => {
      fx.notified.push({ matches, open });
    },
    log: (_level, message) => {
      fx.logs.push(message);
    },
  };
  return fx;
}

describe("scheduler", () => {
  it("runs on profile preferences alone, finding new companies before the scan", async () => {
    const fx = fixture();
    fx.searches = [];
    const scheduler = createScheduler(fx.deps);
    await scheduler.check();
    expect(fx.starts).toBe(0);

    fx.preferences = true;
    await scheduler.check();
    expect(fx.order).toEqual(["discover", "start"]);
  });

  it("runs a due saved search on the first check, and waits for the interval after a finished run", async () => {
    const fx = fixture({ intervalHours: 24 });
    const scheduler = createScheduler(fx.deps);

    await scheduler.check();
    expect(fx.starts).toBe(1);

    await scheduler.handleRunFinished("run-1", "succeeded");
    fx.lastFinished.at = fx.clock.now;
    fx.clock.now += 23 * MS_PER_HOUR;
    await scheduler.check();
    expect(fx.starts).toBe(1);

    fx.clock.now += MS_PER_HOUR;
    await scheduler.check();
    expect(fx.starts).toBe(2);
  });

  it("does not run without saved searches", async () => {
    const fx = fixture();
    fx.searches = [];
    await createScheduler(fx.deps).check();
    expect(fx.starts).toBe(0);
  });

  it("does not start a second run while one it started is still active", async () => {
    const fx = fixture();
    const scheduler = createScheduler(fx.deps);
    await scheduler.check();
    await scheduler.check();
    expect(fx.starts).toBe(1);
    expect(await scheduler.runNow()).toEqual({ ok: false, code: "already-running" });
  });

  it("keeps the run for later when the engine is busy with another one, and logs an unavailable engine", async () => {
    const fx = fixture();
    fx.startAnswer = { ok: false, code: "already-running" };
    await createScheduler(fx.deps).check();
    expect(fx.logs).toEqual([]);

    fx.startAnswer = { ok: false, code: "engine-unavailable" };
    await createScheduler(fx.deps).check();
    expect(fx.logs).toEqual(["scheduled run not started: engine unavailable"]);
  });

  it("notifies once for a run it started that found new matches, with the saved search as the click target", async () => {
    const fx = fixture();
    const scheduler = createScheduler(fx.deps);
    await scheduler.check();
    await scheduler.handleRunFinished("run-1", "succeeded");
    await scheduler.handleRunFinished("run-1", "succeeded");

    expect(fx.notified).toEqual([{ matches: fx.matches, open: { savedSearchId: "s1" } }]);
  });

  it("sends no notification for a run without new matches, a run it did not start, or with notifications off", async () => {
    const empty = fixture();
    empty.matches = { count: 0, topScore: null, searchNames: [], savedSearchId: null };
    const emptyScheduler = createScheduler(empty.deps);
    await emptyScheduler.check();
    await emptyScheduler.handleRunFinished("run-1", "succeeded");
    expect(empty.notified).toEqual([]);

    const foreign = fixture();
    await createScheduler(foreign.deps).handleRunFinished("someone-else", "succeeded");
    expect(foreign.notified).toEqual([]);

    const quiet = fixture({ notifications: false });
    const quietScheduler = createScheduler(quiet.deps);
    await quietScheduler.check();
    await quietScheduler.handleRunFinished("run-1", "succeeded");
    expect(quiet.notified).toEqual([]);
  });

  it("notifies a run started from the tray, and an interrupted run that found jobs", async () => {
    const fx = fixture();
    const scheduler = createScheduler(fx.deps);
    expect(await scheduler.runNow()).toEqual({ ok: true, runId: "run-1" });
    await scheduler.handleRunFinished("run-1", "interrupted");
    expect(fx.notified).toHaveLength(1);
  });

  it("logs a failing store instead of throwing out of the check", async () => {
    const fx = fixture();
    fx.deps.savedSearches = async () => {
      throw new Error("database closed");
    };
    await expect(createScheduler(fx.deps).check()).resolves.toBeUndefined();
    expect(fx.logs.join(" ")).toContain("database closed");
  });
});
