// protects=the jobs screen lists open jobs with scores, scans only when companies exist, opens with the profile's preferences as the filter, links to the sources, follows a scan in a log and cancels it, asks for consent before scoring with a cloud provider, explains an empty list with places by the company-country rule, and shows an error with a retry;
// fails_when=scoring is offered with the AI off, an unscored job looks scored, a scan starts without companies, the profile's preferences are ignored, a cancel misses its run, a cloud call goes without consent, an empty list with places gives no reason or no link to the sources, or an error shows a blank page;
// no_claim=layout, keyboard focus order, the real provider's answers and the real engine run are not checked here; the core ranking tests and the engine and ingestion tests cover the scoring and the run, and company entry is tested on the Sources screen.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_APP_SETTINGS,
  emptyPreferences,
  emptyProfile,
  type CompanyRecord,
  type IngestEvent,
  type JobListItem,
  type JobFinderBridge,
} from "@job-finder/bridge";
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
  country: null,
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
  score: null,
  explanation: null,
  dismissed: false,
  isNew: false,
  applicationStatus: null,
  applicationId: null,
};

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === text,
  );
  if (!found) {
    throw new Error(`no button ${text}`);
  }
  return found;
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

  it("shows the empty states and does not offer a scan when no company is saved", async () => {
    await render(createMemoryBridge());

    expect(container.textContent).toContain("No open jobs yet.");
    expect(container.textContent).toContain("Nothing has been scanned yet.");
    expect(button(container, "Scan companies").disabled).toBe(true);
  });

  it("lists the open jobs with their company, location and work mode, and opens one with its apply page", async () => {
    await render(createMemoryBridge({ companies: [acme], jobs: [{ ...posting, isNew: true }] }));

    expect(container.textContent).toContain("Backend Engineer");
    expect(container.textContent).toContain("Milan, Italy");
    expect(container.textContent).toContain("Hybrid");
    expect([...container.querySelectorAll("span")].some((node) => node.textContent === "New")).toBe(
      true,
    );

    await act(async () => {
      button(container, "Open").click();
    });
    expect(container.textContent).toContain("Dismiss");
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

    expect(button(container, "Scan companies").disabled).toBe(false);
    expect(list).toHaveBeenCalledTimes(2);
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

    await emit({ runId: "run-1", seq: 0, at: 1, kind: "run-started", companyCount: 3 });
    expect(container.textContent).toContain("Scan started.");
    // Progress: no company done yet, out of three.
    expect(container.textContent).toContain("Scanning · 0/3 companies");
    expect(container.querySelector("[role=progressbar]")?.getAttribute("aria-valuemax")).toBe("3");
    // The log follows the scan: a new line scrolls it to the bottom.
    const log = container.querySelector<HTMLOListElement>('ol[aria-labelledby="jobs-log-title"]')!;
    let scrolledTo = 0;
    Object.defineProperty(log, "scrollHeight", { configurable: true, value: 480 });
    Object.defineProperty(log, "scrollTop", {
      configurable: true,
      get: () => scrolledTo,
      set: (value: number) => {
        scrolledTo = value;
      },
    });
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
    // One company is done: 1/3, and a company counted twice would not count twice.
    expect(container.textContent).toContain("Scanning · 1/3 companies");
    expect(container.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")).toBe("1");
    await emit({ runId: "run-1", seq: 2, at: 3, kind: "run-finished", status: "succeeded" });
    expect(container.querySelector("[role=progressbar]")).toBeNull();

    expect(container.textContent).toContain("Acme: 2 postings read, 1 closed.");
    expect(scrolledTo).toBe(480);
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

  it("lists scored jobs with their affinity and explanation, and marks the others as not scored", async () => {
    const scored: JobListItem = {
      ...posting,
      id: "job-2",
      title: "Platform Engineer",
      score: 88,
      explanation: "Strong Kubernetes match; asks for 5+ years, you have 3.",
    };
    await render(createMemoryBridge({ companies: [acme], jobs: [scored, posting] }));

    expect(container.textContent).toContain("Affinity 88/100");
    expect(container.textContent).toContain(
      "Strong Kubernetes match; asks for 5+ years, you have 3.",
    );
    expect(container.textContent).toContain("Not scored yet");
    expect(button(container, "Best match").getAttribute("aria-pressed")).toBe("true");
  });

  it("scores the jobs on the profile, reports the counts and reloads the list with the new scores", async () => {
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
      button(container, "Score jobs").click();
    });
    await act(async () => {});

    expect(start).toHaveBeenCalledWith(expect.objectContaining({ consent: false }));
    expect(container.textContent).toContain("Scored 1 jobs.");
  });

  it("asks for consent before scoring with a cloud provider, and sends the consent with the request", async () => {
    const bridge = createMemoryBridge({ companies: [acme], jobs: [posting] });
    const start = vi.fn(async () => ({ ok: false as const, code: "consent-required" as const }));
    bridge.scores.start = start;
    await render(bridge);

    const consentBox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(consentBox).not.toBeNull();
    await act(async () => {
      consentBox?.click();
    });
    await act(async () => {
      button(container, "Score jobs").click();
    });
    await act(async () => {});

    expect(start).toHaveBeenCalledWith(expect.objectContaining({ consent: true }));
  });

  it("shows the AI unavailable state with a link to Settings and keeps the jobs listed", async () => {
    const bridge = createMemoryBridge({ companies: [acme], jobs: [posting] });
    bridge.scores.start = async () => ({ ok: false, code: "ai-unavailable" });
    await render(bridge);

    await act(async () => {
      button(container, "Score jobs").click();
    });
    await act(async () => {});

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("AI unavailable");
    expect(container.querySelector('a[href="/settings"]')).not.toBeNull();
    expect(container.textContent).toContain("Backend Engineer");
    expect(container.textContent).toContain("Not scored yet");
  });

  it("offers no scoring with the AI off, and says so with a link to Settings", async () => {
    const bridge = createMemoryBridge({
      companies: [acme],
      jobs: [posting],
      settings: DEFAULT_APP_SETTINGS,
    });
    await render(bridge);

    expect(container.textContent).toContain("The AI is off");
    expect(
      [...container.querySelectorAll("button")].some((node) => node.textContent === "Score jobs"),
    ).toBe(false);
    expect(container.querySelector('a[href="/settings"]')).not.toBeNull();
    expect(container.textContent).toContain("Backend Engineer");
  });

  it("opens with the profile's roles and work modes as the filter, keeping jobs that do not say their mode", async () => {
    const memory = createMemoryBridge({
      companies: [acme],
      jobs: [posting],
      profile: {
        ...emptyProfile(),
        preferences: { ...emptyPreferences(), roles: ["Backend Engineer"], workModes: ["remote"] },
      },
    });
    const list = vi.fn(memory.jobs.list);
    await render({ ...memory, jobs: { ...memory.jobs, list } });
    expect(list.mock.calls[0]?.[0].filter.workModes).toEqual(["remote", "unknown"]);
    expect(list.mock.calls[0]?.[0].filter.roles).toEqual(["Backend Engineer"]);
    expect(container.textContent).not.toContain("Find new companies");
    expect(container.querySelector('a[href="/companies"]')?.textContent).toBe("Manage");
  });

  it("explains an empty list with places by the company-country rule, and links to the sources", async () => {
    const memory = createMemoryBridge({
      companies: [acme],
      jobs: [],
      profile: {
        ...emptyProfile(),
        preferences: { ...emptyPreferences(), roles: ["Backend Engineer"], locations: ["Italia"] },
      },
    });
    await render(memory);

    expect(container.textContent).toContain("No job matches your profile's preferences yet.");
    expect(container.textContent).toContain(
      "companies based in the countries and areas you chose (Italia)",
    );
    const link = [...container.querySelectorAll("a")].find(
      (node) => node.textContent === "Open the sources",
    );
    expect(link?.getAttribute("href")).toBe("/companies");
  });
});
