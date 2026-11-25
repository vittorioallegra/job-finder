// protects=the job detail bookmarks a job, prepares in the background (start, both documents, no redirect) and then hides the prepare, dismiss and bookmark buttons, offers only the bookmark of a saved job, asks one or two confirmations for duplicates, shows a refused start, and shows "In preparation" with the writing message while documents are written;
// fails_when=a bookmark is not sent, a warning starts without confirmation, the same job starts after one, a refused start shows no message, a duplicate's details are missing, or the in-preparation chip or writing message is missing or stays after writing;
// no_claim=the layout, keyboard order and the engine's duplicate rules are not covered here; the desktop repository tests cover the guard counts and the core tests cover the confirmation rule;
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuplicateCheck, JobFinderBridge, JobListItem } from "@job-finder/bridge";
import { BridgeProvider } from "../../lib/bridge/BridgeContext";
import { createMemoryBridge } from "../../lib/bridge/memory";
import { i18n } from "../../lib/i18n";
import { startGeneration } from "../../lib/document-generation";
import { JobDetail } from "./JobDetail";

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

const earlier = {
  id: "a0",
  jobId: "job-0",
  jobTitle: "Backend Engineer",
  companyName: "Acme",
  status: "applied" as const,
  statusChangedAt: Date.UTC(2026, 10, 1),
};

const none: DuplicateCheck = { sameJob: [], sameCompany: [], requiredConfirmations: 0 };

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === text,
  );
  if (!found) throw new Error(`no button ${text}`);
  return found;
}

describe("job detail: bookmark and preparation", () => {
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

  const names = () => Array.from(container.querySelectorAll("button")).map((b) => b.textContent);

  async function render(
    bridge: JobFinderBridge,
    onOpenApplication?: (applicationId: string) => void,
  ) {
    await act(async () => {
      root.render(
        <BridgeProvider bridge={bridge}>
          <JobDetail
            jobId="job-1"
            onChanged={() => {}}
            onClose={() => {}}
            onOpenApplication={onOpenApplication}
          />
        </BridgeProvider>,
      );
    });
    await act(async () => {});
  }

  function bridgeWith(applications: Partial<JobFinderBridge["applications"]>): JobFinderBridge {
    const base = createMemoryBridge({ jobs: [posting] });
    return {
      ...base,
      applications: {
        list: async () => [],
        detail: async () => null,
        bookmark: vi.fn(async () => true),
        check: vi.fn(async () => none),
        start: vi.fn(async () => ({
          ok: true as const,
          application: {
            id: "a1",
            jobId: "job-1",
            jobTitle: "Backend Engineer",
            companyId: "c1",
            companyName: "Acme",
            status: "preparing" as const,
            createdAt: 1,
            statusChangedAt: 1,
            jobUrl: posting.url,
            applyUrl: posting.applyUrl,
            events: [],
          },
        })),
        update: vi.fn(),
        exportCsv: vi.fn(),
        ...applications,
      } as JobFinderBridge["applications"],
    };
  }

  it("bookmarks the job and removes the bookmark", async () => {
    const bridge = bridgeWith({});
    await render(bridge);

    await act(async () => {
      button(container, "Bookmark").click();
    });
    expect(bridge.applications.bookmark).toHaveBeenCalledWith({ jobId: "job-1", bookmarked: true });
    expect(container.textContent).toContain("Application: To send");
    // A saved job is already in the tracker: only the bookmark can be undone here.
    expect(names()).toEqual(["Close", "Remove bookmark"]);

    await act(async () => {
      button(container, "Remove bookmark").click();
    });
    expect(bridge.applications.bookmark).toHaveBeenLastCalledWith({
      jobId: "job-1",
      bookmarked: false,
    });
    expect(container.textContent).not.toContain("Application: To send");
  });

  it("prepares in the background: starts the application, writes both documents, and stays on the page", async () => {
    const base = bridgeWith({});
    const kinds: string[] = [];
    const bridge = {
      ...base,
      documents: {
        ...base.documents,
        generate: vi.fn(async ({ kind }: { kind: string }) => {
          kinds.push(kind);
          return { ok: true as const, document: {} };
        }),
      },
    } as unknown as JobFinderBridge;
    const open = vi.fn();
    await render(bridge, open);

    await act(async () => {
      button(container, "Prepare application").click();
    });
    await act(async () => {});
    expect(bridge.applications.start).toHaveBeenCalledWith({ jobId: "job-1", confirmations: 0 });
    expect(kinds).toEqual(["cv", "cover-letter"]);
    expect(container.textContent).toContain("Application prepared: your CV and cover letter");
    // No redirect: the panel offers a link and the user decides.
    expect(open).not.toHaveBeenCalled();
    await act(async () => {
      button(container, "Open the application").click();
    });
    expect(open).toHaveBeenCalledWith("a1");
    expect(names()).not.toContain("Prepare application");
    expect(names()).not.toContain("Dismiss");
    expect(names()).not.toContain("Bookmark");
  });

  it("says so when the documents of a prepared application could not be written, and stops after the first failure", async () => {
    const base = bridgeWith({});
    const generate = vi.fn(async () => ({ ok: false as const, code: "invalid-key" as const }));
    const bridge = { ...base, documents: { ...base.documents, generate } } as JobFinderBridge;
    await render(bridge, vi.fn());

    await act(async () => {
      button(container, "Prepare application").click();
    });
    await act(async () => {});
    expect(generate).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[role=alert]")?.textContent).toContain("could not be written");
  });

  it("shows the application as in preparation, with the writing message, while its documents are being written", async () => {
    let finish: () => void = () => {};
    const base = createMemoryBridge({
      jobs: [{ ...posting, applicationStatus: "preparing", applicationId: "a1" }],
    });
    const bridge = {
      ...base,
      documents: {
        ...base.documents,
        generate: vi.fn(
          () =>
            new Promise((resolve) => {
              finish = () => resolve({ ok: false, code: "unknown" });
            }),
        ),
      },
    } as unknown as JobFinderBridge;

    void startGeneration(bridge, "a1", ["cv"]);
    await render(bridge);
    expect(container.textContent).toContain("Application: In preparation");
    expect(container.textContent).toContain("Writing your CV");

    await act(async () => finish());
    await act(async () => {});
    expect(container.textContent).toContain("Application: To send");
    expect(container.textContent).not.toContain("Writing your CV");
  });

  it("asks one confirmation for an earlier application at the same company", async () => {
    const check = vi.fn(async () => ({
      sameJob: [],
      sameCompany: [earlier],
      requiredConfirmations: 1 as const,
    }));
    const bridge = bridgeWith({ check });
    await render(bridge);

    await act(async () => {
      button(container, "Prepare application").click();
    });
    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      "This company has an application changed in the last 90 days: 1.",
    );
    expect(bridge.applications.start).not.toHaveBeenCalled();

    await act(async () => {
      button(container, "I understand, prepare anyway").click();
    });
    await act(async () => {});
    expect(bridge.applications.start).toHaveBeenCalledWith({ jobId: "job-1", confirmations: 1 });
  });

  it("asks two confirmations for an earlier application for the same job, and starts only after the second", async () => {
    const check = vi.fn(async () => ({
      sameJob: [earlier],
      sameCompany: [],
      requiredConfirmations: 2 as const,
    }));
    const bridge = bridgeWith({ check });
    await render(bridge);

    await act(async () => {
      button(container, "Prepare application").click();
    });
    expect(container.textContent).toContain("This job already has an application");
    expect(container.textContent).toContain("Backend Engineer at Acme: Applied");

    await act(async () => {
      button(container, "I understand, prepare anyway").click();
    });
    expect(bridge.applications.start).not.toHaveBeenCalled();
    expect(button(container, "Confirm again: prepare a second application")).toBeTruthy();

    await act(async () => {
      button(container, "Confirm again: prepare a second application").click();
    });
    await act(async () => {});
    expect(bridge.applications.start).toHaveBeenCalledWith({ jobId: "job-1", confirmations: 2 });
  });

  it("shows the failure when the start is refused", async () => {
    const bridge = bridgeWith({
      start: vi.fn(async () => ({ ok: false as const, code: "job-not-found" as const })),
    });
    await render(bridge);

    await act(async () => {
      button(container, "Prepare application").click();
    });
    await act(async () => {});
    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      "The application could not be started.",
    );
  });
});
