// protects=the update check asks the engine at most once a day, asks nothing while the setting is off (and clears a shown notice), reports a newer release once, and treats an engine failure as no answer rather than as an update;
// fails_when=the check runs again inside the day, runs while disabled, reports the same release twice, keeps a notice after the setting is turned off, or reports an error outcome as a new version;
// no_claim=the engine's request to GitHub and the fixture override are covered by the core release tests and the engine tests.
import { describe, expect, it } from "vitest";
import type { UpdateCheckOutcome } from "@job-finder/core/updates";
import { createUpdateService, UPDATE_CHECK_INTERVAL_MS, type UpdateEngine } from "./update-service";
import type { UpdateNotice } from "@job-finder/bridge";

interface Harness {
  clock: { now: number };
  enabled: { value: boolean };
  outcome: { value: UpdateCheckOutcome | "throws" };
  asked: string[];
  changes: Array<UpdateNotice | null>;
  logs: string[];
  engine: { value: UpdateEngine | null };
}

function harness(): Harness {
  const h: Harness = {
    clock: { now: 1_000 },
    enabled: { value: true },
    outcome: { value: { ok: true, release: null } },
    asked: [],
    changes: [],
    logs: [],
    engine: { value: null },
  };
  h.engine.value = {
    checkForUpdate: async (currentVersion) => {
      h.asked.push(currentVersion);
      if (h.outcome.value === "throws") throw new Error("engine gone");
      return h.outcome.value;
    },
  };
  return h;
}

function service(h: Harness) {
  return createUpdateService({
    engine: () => h.engine.value,
    currentVersion: "0.2.0",
    enabled: async () => h.enabled.value,
    now: () => h.clock.now,
    onChange: (notice) => {
      h.changes.push(notice);
    },
    log: (_level, message) => {
      h.logs.push(message);
    },
  });
}

describe("update service", () => {
  it("reports a newer release once, with the version and its page", async () => {
    const h = harness();
    h.outcome.value = {
      ok: true,
      release: { version: "0.3.0", url: "https://example.test/v0.3.0" },
    };
    const updates = service(h);

    await updates.check();
    await updates.check();

    expect(h.asked).toEqual(["0.2.0", "0.2.0"]);
    expect(h.changes).toEqual([{ version: "0.3.0", url: "https://example.test/v0.3.0" }]);
    expect(updates.notice()).toEqual({ version: "0.3.0", url: "https://example.test/v0.3.0" });
  });

  it("asks at most once a day when checked again", async () => {
    const h = harness();
    const updates = service(h);

    await updates.checkIfDue();
    h.clock.now += UPDATE_CHECK_INTERVAL_MS - 1;
    await updates.checkIfDue();
    expect(h.asked).toHaveLength(1);

    h.clock.now += 1;
    await updates.checkIfDue();
    expect(h.asked).toHaveLength(2);
  });

  it("asks nothing while the setting is off, and clears a notice that was shown", async () => {
    const h = harness();
    h.outcome.value = {
      ok: true,
      release: { version: "0.3.0", url: "https://example.test/v0.3.0" },
    };
    const updates = service(h);
    await updates.check();

    h.enabled.value = false;
    await updates.check();

    expect(h.asked).toHaveLength(1);
    expect(updates.notice()).toBeNull();
    expect(h.changes.at(-1)).toBeNull();
  });

  it("treats a failed or missing engine as no answer, and logs it", async () => {
    const h = harness();
    const updates = service(h);

    h.outcome.value = { ok: false, code: "unavailable" };
    await updates.check();
    expect(updates.notice()).toBeNull();
    expect(h.logs).toEqual(["update check failed: unavailable"]);

    h.outcome.value = "throws";
    await updates.check();
    expect(updates.notice()).toBeNull();

    h.engine.value = null;
    await updates.check();
    expect(h.asked).toHaveLength(2);
  });
});
