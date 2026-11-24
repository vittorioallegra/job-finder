// protects=the jobs screen lists open jobs with their affinity score and explanation (unscored jobs marked as not scored), starts a scan only when companies exist, opens with the profile's preferences as the filter, finds companies from the profile (also on ?discover=1), follows its progress in the log and cancels it by run id, says when a scan is already running, asks for consent before scoring with a cloud provider, shows the AI unavailable state while keeping the jobs listed, and shows an error with a retry when the lists cannot be read;
// fails_when=an open job is not shown, a scan starts with no companies, a scored job shows no score or an unscored one shows a number, scoring starts with a cloud provider before the consent box is ticked, an AI failure hides the jobs, a second scan starts while one is running without a message, progress or the cancel is not wired to the run id, or a failed read shows a blank page;
// no_claim=layout, keyboard focus order, the real provider's answers and the real engine run are not checked here; the core ranking tests and the engine and ingestion tests cover the scoring and the run, and company entry is tested on the Sources screen.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
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
    expect(container.textContent).toContain(
      "No company yet: they come from what you are looking for",
    );
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

  it("opens with the profile's work modes as the filter, keeping jobs that do not say", async () => {
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
    expect(container.textContent).toContain("Find new companies");
  });

  it("finds companies from the profile on ?discover=1 and says what it added", async () => {
    const memory = createMemoryBridge({
      companies: [acme],
      profile: {
        ...emptyProfile(),
        preferences: { ...emptyPreferences(), roles: ["Backend Engineer"] },
      },
      profileDiscovery: { ok: true, found: 3, added: 2, runStarted: true },
    });
    const fromProfile = vi.fn(memory.discovery.fromProfile);
    let path = "";
    function Where() {
      const location = useLocation();
      path = `${location.pathname}${location.search}`;
      return null;
    }
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/jobs?discover=1"]}>
          <BridgeProvider bridge={{ ...memory, discovery: { ...memory.discovery, fromProfile } }}>
            <Routes>
              <Route
                path="/jobs"
                element={
                  <>
                    <JobsScreen />
                    <Where />
                  </>
                }
              />
            </Routes>
          </BridgeProvider>
        </MemoryRouter>,
      );
    });
    await act(async () => {});
    await act(async () => {});
    expect(fromProfile).toHaveBeenCalledTimes(1);
    expect(path).toBe("/jobs");
    expect(container.textContent).toContain("Added 2 new companies out of 3 found.");
    expect(container.textContent).toContain("Their jobs are being read now.");
  });

  it("points to the profile when it names no role yet", async () => {
    await render(createMemoryBridge({ companies: [acme], profile: emptyProfile() }));
    expect(container.textContent).toContain("Say which roles you are looking for in your profile");
    expect(() => button(container, "Find new companies")).toThrow();
  });
});
