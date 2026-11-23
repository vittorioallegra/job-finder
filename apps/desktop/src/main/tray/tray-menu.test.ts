// protects=the tray menu offers Open, Search now (only while the engine runs), Quit, and names a newer version or a stopped engine, and the tooltip says when the engine has stopped;
// fails_when=Search now is enabled while the engine is restarting or failed, the engine failure or the update is not shown, Quit is missing, or the tooltip hides a stopped engine;
// no_claim=how the menu is drawn on each operating system and the Electron tray object itself are not exercised.
import { describe, expect, it } from "vitest";
import type { AppStatus } from "@job-finder/bridge";
import { createTranslator } from "../i18n";
import { trayMenuEntries, trayTooltip, type TrayActions } from "./tray-menu";

const en = createTranslator("en");
const actions: TrayActions = { open: () => {}, searchNow: () => {}, quit: () => {} };
const status = (overrides: Partial<AppStatus>): AppStatus => ({
  engine: "running",
  update: null,
  ...overrides,
});

describe("tray menu", () => {
  it("offers Open, Search now and Quit, with Search now enabled while the engine runs", () => {
    const labels = trayMenuEntries(en, status({}), actions).map((entry) => [
      entry.label,
      entry.enabled,
    ]);
    expect(labels).toEqual([
      ["Open Job Finder", undefined],
      ["Search now", true],
      [undefined, undefined],
      ["Quit", undefined],
    ]);
  });

  it("disables Search now and names the stopped engine when the engine failed", () => {
    const entries = trayMenuEntries(en, status({ engine: "failed" }), actions);
    expect(entries.find((entry) => entry.label === "Search now")?.enabled).toBe(false);
    expect(
      entries.some((entry) => entry.label === "Search engine stopped. Restart Job Finder."),
    ).toBe(true);
    expect(trayTooltip(en, status({ engine: "failed" }))).toContain("stopped");
    expect(trayTooltip(en, status({}))).toBe("Job Finder");
  });

  it("names a newer version and opens the window from it", () => {
    let opened = 0;
    const entries = trayMenuEntries(
      en,
      status({ update: { version: "0.3.0", url: "https://example.test" } }),
      {
        ...actions,
        open: () => {
          opened += 1;
        },
      },
    );
    const update = entries.find((entry) => entry.label === "Version 0.3.0 is available");
    expect(update).toBeDefined();
    update?.click?.();
    expect(opened).toBe(1);
  });
});
