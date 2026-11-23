// protects=the app shows a stopped search engine as an alert, shows a newer release with its page button and a dismiss action for the session, and shows nothing while the engine runs and no newer release exists;
// fails_when=a stopped engine is not announced, a release notice shows without its version, dismissing does not hide it, the page button does not ask main to open the page, or a healthy app shows a banner;
// no_claim=the operating system's browser opening the release page and the tray's own notices are not exercised here.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppStatus } from "@job-finder/bridge";
import { BridgeProvider } from "../lib/bridge/BridgeContext";
import { createMemoryBridge } from "../lib/bridge/memory";
import { i18n } from "../lib/i18n";
import { AppNotices } from "./AppNotices";

describe("app notices", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await i18n.changeLanguage("en");
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(status: AppStatus) {
    const bridge = createMemoryBridge({ appStatus: status });
    await act(async () => {
      root.render(
        <BridgeProvider bridge={bridge}>
          <AppNotices />
        </BridgeProvider>,
      );
    });
    return bridge;
  }

  it("shows nothing while the engine runs and no newer release exists", async () => {
    await render({ engine: "running", update: null });
    expect(container.textContent).toBe("");
  });

  it("announces a stopped search engine", async () => {
    await render({ engine: "failed", update: null });
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("The search engine stopped");
  });

  it("shows a newer release, opens its page on request, and dismisses for the session", async () => {
    const bridge = await render({
      engine: "running",
      update: { version: "0.3.0", url: "https://github.com/acme/job-finder/releases/tag/v0.3.0" },
    });
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Job Finder 0.3.0 is available.");

    const open = vi.spyOn(bridge.app, "openUpdate");
    const openButton = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === "Open release page",
    );
    await act(async () => {
      openButton?.click();
    });
    expect(open).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Opening the update page failed.");

    const dismiss = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === "Dismiss",
    );
    await act(async () => {
      dismiss?.click();
    });
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
