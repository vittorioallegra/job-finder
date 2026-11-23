// protects=the jobs screen lists companies and open jobs, adds a company through the bridge and shows why one is refused, starts a scan, follows its progress in the log and cancels it, and shows an error with a retry when the lists cannot be read;
// fails_when=a saved company or job is not shown, a refused company is shown as added, a second scan starts while one is running without a message, progress or the cancel is not wired to the run id, or a failed read shows a blank page;
// no_claim=layout, keyboard focus order and the real engine run are not checked here; the engine and core ingestion tests cover the run.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyRecord, IngestEvent, JobListItem, JobFinderBridge } from "@job-finder/bridge";
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
};

const posting: JobListItem = {
  id: "job-1",
  title: "Backend Engineer",
  companyName: "Acme",
  locations: ["Milan, Italy"],
  workMode: "hybrid",
  url: "https://boards.greenhouse.io/acme/jobs/1",
  applyUrl: "https://boards.greenhouse.io/acme/jobs/1",
  firstSeenAt: 1,
};

function setInputValue(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === text,
  );
  if (!found) {
    throw new Error(`no button ${text}`);
  }
  return found;
}

function field(container: HTMLElement, labelText: string): HTMLInputElement {
  const label = [...container.querySelectorAll("label")].find((node) =>
    node.textContent?.includes(labelText),
  );
  const control = label?.htmlFor ? container.ownerDocument.getElementById(label.htmlFor) : null;
  if (!(control instanceof HTMLInputElement)) {
    throw new Error(`no input labelled ${labelText}`);
  }
  return control;
}

describe("jobs screen", () => {
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

  async function render(bridge: JobFinderBridge) {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <BridgeProvider bridge={bridge}>
            <JobsScreen />
          </BridgeProvider>
        </MemoryRouter>,
      );
    });
    await act(async () => {});
  }

  it("shows the empty states when nothing is stored yet", async () => {
    await render(createMemoryBridge());

    expect(container.textContent).toContain("No companies yet.");
    expect(container.textContent).toContain("No open jobs yet.");
    expect(container.textContent).toContain("Nothing has been scanned yet.");
    expect(button(container, "Scan companies").disabled).toBe(true);
  });

  it("lists the saved companies and the open jobs with their board and apply link", async () => {
    await render(createMemoryBridge({ companies: [acme], jobs: [posting] }));

    expect(container.textContent).toContain("Acme");
    expect(container.textContent).toContain("Board: greenhouse");
    expect(container.textContent).toContain("Backend Engineer");
    expect(container.textContent).toContain("Hybrid");
    expect(container.textContent).toContain(`Apply page: ${posting.applyUrl}`);
  });

  it("shows an error with a retry when the lists cannot be read, and recovers on retry", async () => {
    const bridge = createMemoryBridge({ companies: [acme] });
    const list = vi
      .fn<() => Promise<CompanyRecord[]>>()
      .mockRejectedValueOnce(new Error("read failed"))
      .mockResolvedValue([acme]);
    bridge.companies.list = list;
    await render(bridge);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded");
    await act(async () => {
      button(container, "Try again").click();
    });
    await act(async () => {});

    expect(container.textContent).toContain("Acme");
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("adds a company through the bridge and shows it in the list", async () => {
    const bridge = createMemoryBridge();
    const add = vi.spyOn(bridge.companies, "add");
    await render(bridge);

    await act(async () => {
      setInputValue(field(container, "Company name"), "Acme");
      setInputValue(field(container, "Careers page link"), "https://boards.greenhouse.io/acme");
    });
    await act(async () => {
      button(container, "Add company").click();
    });
    await act(async () => {});

    expect(add).toHaveBeenCalledWith({
      name: "Acme",
      careersUrl: "https://boards.greenhouse.io/acme",
    });
    expect(container.textContent).toContain("Company added.");
    expect(container.querySelector("ul")?.textContent).toContain("Acme");
  });

  it("shows why a company is refused and keeps the list unchanged", async () => {
    const bridge = createMemoryBridge();
    bridge.companies.add = async () => ({ ok: false, code: "duplicate-company" });
    await render(bridge);

    await act(async () => {
      setInputValue(field(container, "Company name"), "Acme");
      setInputValue(field(container, "Careers page link"), "https://boards.greenhouse.io/acme");
    });
    await act(async () => {
      button(container, "Add company").click();
    });
    await act(async () => {});

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("already in the list");
    expect(container.textContent).not.toContain("Company added.");
  });

  it("starts a scan, follows its progress in the log and cancels it by run id", async () => {
    const listeners: Array<(event: IngestEvent) => void> = [];
    const bridge = createMemoryBridge({ companies: [acme] });
    bridge.ingest.start = async () => ({ ok: true, runId: "run-1" });
    const cancel = vi.fn(async () => {});
    bridge.ingest.cancel = cancel;
    bridge.ingest.onProgress = (listener) => {
      listeners.push(listener);
      return () => {};
    };
    await render(bridge);

    await act(async () => {
      button(container, "Scan companies").click();
    });
    await act(async () => {});
    const emit = (event: IngestEvent) => act(() => listeners.forEach((l) => l(event)));

    await emit({ runId: "run-1", seq: 0, at: 1, kind: "run-started" });
    expect(container.textContent).toContain("Scan started.");
    await act(async () => {
      button(container, "Cancel scan").click();
    });
    expect(cancel).toHaveBeenCalledWith("run-1");

    await emit({
      runId: "run-1",
      seq: 1,
      at: 2,
      kind: "company-scanned",
      companyId: "co-1",
      companyName: "Acme",
      jobCount: 2,
      closedCount: 1,
    });
    await emit({ runId: "run-1", seq: 2, at: 3, kind: "run-finished", status: "succeeded" });

    expect(container.textContent).toContain("Acme: 2 postings read, 1 closed.");
    expect(container.textContent).toContain("Scan finished: completed.");
    expect(button(container, "Scan companies").disabled).toBe(false);
  });

  it("says that a scan is already running when the engine refuses a second one", async () => {
    const bridge = createMemoryBridge({ companies: [acme] });
    bridge.ingest.start = async () => ({ ok: false, code: "already-running" });
    await render(bridge);

    await act(async () => {
      button(container, "Scan companies").click();
    });
    await act(async () => {});

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("already running");
  });
});
