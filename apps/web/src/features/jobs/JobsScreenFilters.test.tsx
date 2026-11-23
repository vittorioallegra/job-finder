// protects=the jobs screen applies the filter form to the job list with the chosen order, refuses an invalid filter with a message, says when no job matches, dismisses a job from its detail, creates and applies saved searches, and scores the jobs the filter lets through with the listed ones first;
// fails_when=a filter value is dropped before the list is read, an invalid value is applied, the order is not sent, a dismissed job stays listed as not dismissed, a saved search is not stored or not applied to the form, or scoring is asked without the filter and the listed jobs;
// no_claim=the layout, keyboard order and the engine's filtering are not checked here; the desktop filter tests cover the SQL, and the core tests cover the schema;
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyRecord, JobListItem, SavedSearch } from "@job-finder/bridge";
import { BridgeProvider } from "../../lib/bridge/BridgeContext";
import { createMemoryBridge } from "../../lib/bridge/memory";
import { i18n } from "../../lib/i18n";
import { JobsScreen } from "./JobsScreen";

const acme: CompanyRecord = {
  id: "co-1",
  name: "Acme",
  careersUrl: "https://boards.greenhouse.io/acme",
  ats: "greenhouse",
  slug: "acme",
  createdAt: 1,
  lastScan: null,
};

const posting: JobListItem = {
  id: "job-1",
  title: "Backend Engineer",
  companyName: "Acme",
  locations: ["Milan, Italy"],
  workMode: "hybrid",
  url: "https://boards.greenhouse.io/acme/jobs/1",
  applyUrl: "https://boards.greenhouse.io/acme/jobs/1",
  postedAt: null,
  firstSeenAt: 1,
  score: 80,
  explanation: "Strong backend match.",
  dismissed: false,
  isNew: false,
  applicationStatus: null,
};

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === text,
  );
  if (!found) throw new Error(`no button ${text}`);
  return found;
}

function buttonNamed(container: HTMLElement, label: string): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!found) throw new Error(`no button named ${label}`);
  return found;
}

function field(container: HTMLElement, label: string): HTMLInputElement {
  const labelNode = [...container.querySelectorAll("label")].find(
    (node) => node.textContent?.trim() === label,
  );
  const input = labelNode ? document.getElementById(labelNode.htmlFor) : null;
  if (!(input instanceof HTMLInputElement)) throw new Error(`no field ${label}`);
  return input;
}

function checkbox(container: HTMLElement, label: string): HTMLInputElement {
  const labelNode = [...container.querySelectorAll("label")].find(
    (node) => node.textContent?.trim() === label,
  );
  const input = labelNode?.querySelector("input");
  if (!input) throw new Error(`no checkbox ${label}`);
  return input;
}

function setInputValue(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("jobs screen filters", () => {
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

  async function render(bridge: ReturnType<typeof createMemoryBridge>) {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <BridgeProvider bridge={bridge}>
            <JobsScreen />
          </BridgeProvider>
        </MemoryRouter>,
      );
    });
  }

  it("applies the keywords and the chosen work mode, sending them with the order", async () => {
    const bridge = createMemoryBridge({ companies: [acme], jobs: [posting] });
    const list = vi.spyOn(bridge.jobs, "list");
    await render(bridge);

    await act(async () => {
      setInputValue(field(container, "Keywords (any of them, comma separated)"), "backend, go");
      checkbox(container, "Hybrid").click();
    });
    await act(async () => {
      button(container, "Apply filters").click();
    });

    expect(list).toHaveBeenLastCalledWith({
      filter: expect.objectContaining({ keywords: ["backend", "go"], workModes: ["hybrid"] }),
      sort: "affinity",
    });
  });

  it("sends the newest-first order when the toggle is pressed", async () => {
    const bridge = createMemoryBridge({ companies: [acme], jobs: [posting] });
    const list = vi.spyOn(bridge.jobs, "list");
    await render(bridge);

    await act(async () => {
      button(container, "Newest first").click();
    });

    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "newest" }));
    expect(button(container, "Newest first").getAttribute("aria-pressed")).toBe("true");
  });

  it("says which values to check and does not read the list for an invalid filter", async () => {
    const bridge = createMemoryBridge({ companies: [acme], jobs: [posting] });
    const list = vi.spyOn(bridge.jobs, "list");
    await render(bridge);
    const readsBefore = list.mock.calls.length;

    await act(async () => {
      setInputValue(field(container, "Minimum affinity (0 to 100)"), "150");
    });
    await act(async () => {
      button(container, "Apply filters").click();
    });

    expect(container.textContent).toContain("Check the filters");
    expect(list.mock.calls.length).toBe(readsBefore);
  });

  it("says when no job matches the filters, and keeps the empty message for the default view", async () => {
    const bridge = createMemoryBridge({ companies: [acme], jobs: [] });
    await render(bridge);
    expect(container.textContent).toContain("No open jobs yet.");

    await act(async () => {
      setInputValue(field(container, "Keywords (any of them, comma separated)"), "rust");
    });
    await act(async () => {
      button(container, "Apply filters").click();
    });

    expect(container.textContent).toContain("No job matches these filters.");
  });

  it("dismisses a job from its detail and shows the restore action afterwards", async () => {
    const bridge = createMemoryBridge({ companies: [acme], jobs: [posting] });
    const flag = vi.spyOn(bridge.jobs, "flag");
    await render(bridge);

    await act(async () => {
      buttonNamed(container, "Open Backend Engineer").click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      button(container, "Dismiss").click();
    });

    expect(flag).toHaveBeenCalledWith({ jobId: "job-1", dismissed: true });
    expect(button(container, "Restore")).toBeTruthy();
  });

  it("creates a saved search from the applied filters and applies it to the form later", async () => {
    const bridge = createMemoryBridge({ companies: [acme], jobs: [posting], savedSearches: [] });
    const save = vi.spyOn(bridge.savedSearches, "save");
    await render(bridge);

    await act(async () => {
      setInputValue(field(container, "Keywords (any of them, comma separated)"), "backend");
    });
    await act(async () => {
      button(container, "Apply filters").click();
    });
    await act(async () => {
      setInputValue(field(container, "Name for the current filters"), "Backend");
    });
    await act(async () => {
      button(container, "Save current filters").click();
    });

    expect(save).toHaveBeenCalledWith({
      name: "Backend",
      filter: expect.objectContaining({ keywords: ["backend"] }),
    });
    const stored: SavedSearch[] = await bridge.savedSearches.list();
    expect(stored.map((search) => search.name)).toEqual(["Backend"]);

    await act(async () => {
      setInputValue(field(container, "Keywords (any of them, comma separated)"), "");
    });
    await act(async () => {
      buttonNamed(container, "Apply the saved search Backend").click();
    });

    expect(field(container, "Keywords (any of them, comma separated)").value).toBe("backend");
  });

  it("scores the jobs the filter lets through, with the listed jobs first", async () => {
    const bridge = createMemoryBridge({ companies: [acme], jobs: [posting] });
    const start = vi.fn(async () => ({
      ok: true as const,
      scored: 1,
      cached: 0,
      failed: 0,
      skipped: 0,
    }));
    bridge.scores.start = start;
    await render(bridge);

    await act(async () => {
      setInputValue(field(container, "Keywords (any of them, comma separated)"), "backend");
    });
    await act(async () => {
      button(container, "Apply filters").click();
    });
    await act(async () => {
      button(container, "Score jobs").click();
    });

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({ keywords: ["backend"] }),
        visibleJobIds: ["job-1"],
      }),
    );
  });
});
