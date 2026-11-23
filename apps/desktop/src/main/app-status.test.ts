// protects=the status the windows and the tray show changes only when the engine state or the update notice really changes, and every change is published with the complete status;
// fails_when=an unchanged status is published again, a change drops the other field, or a published status can be edited by its receiver;
// no_claim=how the banner and the tray render the status is not checked here.
import { describe, expect, it } from "vitest";
import type { AppStatus } from "@job-finder/bridge";
import { createAppStatusStore } from "./app-status";

describe("app status store", () => {
  it("publishes only real changes, each with the whole status", () => {
    const published: AppStatus[] = [];
    const store = createAppStatusStore({ engine: "running", update: null }, (status) =>
      published.push(status),
    );

    store.setEngine("running");
    store.setEngine("restarting");
    store.setUpdate({ version: "0.3.0", url: "https://example.test" });
    store.setEngine("failed");

    expect(published).toEqual([
      { engine: "restarting", update: null },
      { engine: "restarting", update: { version: "0.3.0", url: "https://example.test" } },
      { engine: "failed", update: { version: "0.3.0", url: "https://example.test" } },
    ]);
  });

  it("hands out copies, so a receiver cannot change the stored status", () => {
    const store = createAppStatusStore({ engine: "running", update: null }, () => {});
    const copy = store.get();
    copy.engine = "failed";
    expect(store.get().engine).toBe("running");
  });
});
