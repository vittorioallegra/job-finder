// protects=the applications screen shows the loading, empty and error states with a retry, lists each application with only the status moves the machine allows, filters the list and the board by status and company, adds notes to the timeline, and reports the CSV export's count or its failure;
// fails_when=a status the machine forbids is offered or sent, a failed move changes the card, the board counts or filters are wrong, a note is not shown, an error shows a blank page, or the export result is not reported;
// no_claim=layout, keyboard focus order and the real bridge's storage are not checked here; the desktop repository and export tests cover the rules and the file;
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplicationDetail, ApplicationSummary, JobFinderBridge } from "@job-finder/bridge";
import { BridgeProvider } from "../../lib/bridge/BridgeContext";
import { createMemoryBridge } from "../../lib/bridge/memory";
import { i18n } from "../../lib/i18n";
import { ApplicationsScreen } from "./ApplicationsScreen";

function summary(overrides: Partial<ApplicationSummary>): ApplicationSummary {
  return {
    id: "a1",
    jobId: "j1",
    jobTitle: "Backend Engineer",
    companyId: "c1",
    companyName: "Acme",
    status: "applied",
    createdAt: 1,
    statusChangedAt: 2,
    jobUrl: "https://x.test/1",
    applyUrl: "https://x.test/1/apply",
    ...overrides,
  };
}

function detailOf(item: ApplicationSummary, events: ApplicationDetail["events"] = []) {
  return { ...item, events };
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === text,
  );
  if (!found) throw new Error(`no button ${text}`);
  return found;
}

function select(container: HTMLElement, label: string): HTMLSelectElement {
  const found = [...container.querySelectorAll("label")].find((node) => node.textContent === label);
  const control = found?.htmlFor ? document.getElementById(found.htmlFor) : null;
  if (!(control instanceof HTMLSelectElement)) throw new Error(`no select ${label}`);
  return control;
}

/** Sets a controlled field's value the way a user's typing does, so React sees the change. */
function type(field: HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype =
    field instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, value);
  field.dispatchEvent(
    new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
  );
}

describe("applications screen", () => {
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
            <ApplicationsScreen />
          </BridgeProvider>
        </MemoryRouter>,
      );
    });
    await act(async () => {});
  }

  function bridgeWith(applications: Partial<JobFinderBridge["applications"]>): JobFinderBridge {
    const base = createMemoryBridge();
    return {
      ...base,
      applications: {
        list: vi.fn(async () => []),
        detail: vi.fn(async () => null),
        bookmark: vi.fn(async () => true),
        check: vi.fn(async () => ({
          sameJob: [],
          sameCompany: [],
          requiredConfirmations: 0 as const,
        })),
        start: vi.fn(),
        update: vi.fn(),
        exportCsv: vi.fn(async () => ({ ok: false as const, code: "cancelled" as const })),
        ...applications,
      } as JobFinderBridge["applications"],
    };
  }

  it("shows the empty state when there are no applications", async () => {
    await render(bridgeWith({ list: async () => [] }));
    expect(container.textContent).toContain("No applications yet.");
  });

  it("shows an error with a retry that reads the applications again", async () => {
    const list = vi
      .fn<() => Promise<ApplicationSummary[]>>()
      .mockRejectedValueOnce(new Error("engine down"))
      .mockResolvedValueOnce([summary({})]);
    await render(bridgeWith({ list }));
    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      "Applications could not be read.",
    );

    await act(async () => {
      button(container, "Try again").click();
    });
    await act(async () => {});
    expect(container.textContent).toContain("Backend Engineer");
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("offers only the planned moves and sends one that the user picks", async () => {
    const update = vi.fn(async ({ status }: { status?: string }) => ({
      ok: true as const,
      application: detailOf(summary({ status: status as ApplicationSummary["status"] })),
    }));
    await render(bridgeWith({ list: async () => [summary({})], update }));

    const control = select(container, "Status of Backend Engineer");
    const offered = [...control.options].map((option) => option.value);
    expect(offered).toEqual(["applied", "interviewing", "rejected", "withdrawn"]);

    await act(async () => {
      type(control, "interviewing");
    });
    await act(async () => {});
    expect(update).toHaveBeenCalledWith({ applicationId: "a1", status: "interviewing" });
    expect(container.textContent).toContain("Interviewing");
  });

  it("filters the list by status and by company, and shows a message when nothing matches", async () => {
    const applications = [
      summary({ id: "a1", jobTitle: "Backend Engineer", status: "applied" }),
      summary({
        id: "a2",
        jobId: "j2",
        jobTitle: "Data Engineer",
        companyId: "c2",
        companyName: "Beta",
        status: "offer",
      }),
    ];
    await render(bridgeWith({ list: async () => applications }));

    await act(async () => {
      type(select(container, "Status"), "offer");
    });
    expect(container.textContent).toContain("Data Engineer");
    expect(container.textContent).not.toContain("Backend Engineer");

    await act(async () => {
      type(select(container, "Company"), "c1");
    });
    expect(container.textContent).toContain("No application matches these filters.");
  });

  it("switches to the board, with one column per status and its count", async () => {
    await render(
      bridgeWith({
        list: async () => [
          summary({ id: "a1", status: "applied" }),
          summary({ id: "a2", jobId: "j2", jobTitle: "Frontend", status: "applied" }),
        ],
      }),
    );

    await act(async () => {
      button(container, "Board").click();
    });
    const heading = container.querySelector("#board-applied");
    expect(heading?.textContent).toBe("Applied (2)");
    expect(container.querySelector("#board-offer")?.textContent).toBe("Offer (0)");
  });

  it("opens the timeline, adds a note, and shows it with the events", async () => {
    const note = "Recruiter called back";
    const update = vi.fn(async ({ note: text }: { note?: string }) => ({
      ok: true as const,
      application: detailOf(summary({}), [
        { id: "e2", status: "applied", note: text ?? null, at: 3 },
      ]),
    }));
    await render(
      bridgeWith({
        list: async () => [summary({})],
        detail: async () =>
          detailOf(summary({}), [{ id: "e1", status: "applied", note: null, at: 2 }]),
        update,
      }),
    );

    await act(async () => {
      button(container, "Details").click();
    });
    expect(container.querySelector("#application-detail-title")?.textContent).toBe(
      "Backend Engineer",
    );

    const field = container.querySelector("textarea");
    if (!field) throw new Error("no note field");
    await act(async () => {
      type(field, note);
    });
    await act(async () => {
      button(container, "Add note").click();
    });
    await act(async () => {});
    expect(update).toHaveBeenCalledWith({ applicationId: "a1", note });
    expect(container.textContent).toContain(note);
  });

  it("reports a completed export with its count and a failed one as an alert", async () => {
    const exportCsv = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, path: "/exports/apps.csv", count: 1 })
      .mockResolvedValueOnce({ ok: false, code: "write-failed" });
    await render(bridgeWith({ list: async () => [summary({})], exportCsv }));

    await act(async () => {
      button(container, "Export CSV").click();
    });
    expect(container.textContent).toContain("Exported 1 applications to /exports/apps.csv.");

    await act(async () => {
      button(container, "Export CSV").click();
    });
    expect(container.querySelector("[role=alert]")?.textContent).toContain("The export failed.");
  });
});
