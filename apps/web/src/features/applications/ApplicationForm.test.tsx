// protects=the form panel opens the form only for an application being prepared, shows what was filled and what the user must still fill, names each failure, and moves the application to applied only when the user confirms the submission;
// fails_when=the form opens for an applied or bookmarked application, a refused start is reported as opened, the left-over fields are hidden, a failure shows no message, or "I submitted it" changes the status without the user pressing it or before the application is ready;
// no_claim=the form window, the page scripts and the real status machine are not run here; the desktop tests and the Electron end-to-end test cover them;
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApplicationDetail as ApplicationDetailRecord,
  AutofillStartResult,
  JobFinderBridge,
} from "@job-finder/bridge";
import { BridgeProvider } from "../../lib/bridge/BridgeContext";
import { createMemoryBridge } from "../../lib/bridge/memory";
import { i18n } from "../../lib/i18n";
import { ApplicationForm } from "./ApplicationForm";

function application(overrides: Partial<ApplicationDetailRecord> = {}): ApplicationDetailRecord {
  return {
    id: "a1",
    jobId: "j1",
    jobTitle: "Software Engineer",
    companyId: "c1",
    companyName: "Acme",
    status: "ready",
    createdAt: 1,
    statusChangedAt: 1,
    jobUrl: "https://boards.greenhouse.io/acme/jobs/1",
    applyUrl: "https://boards.greenhouse.io/acme/jobs/1",
    events: [],
    ...overrides,
  };
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === text,
  );
  if (!found) throw new Error(`no button ${text}`);
  return found;
}

function bridgeWith(
  start: () => Promise<AutofillStartResult>,
  update = vi.fn(async () => ({
    ok: true as const,
    application: application({ status: "applied" }),
  })),
): JobFinderBridge {
  const base = createMemoryBridge({});
  return {
    ...base,
    autofill: { start: vi.fn(start) },
    applications: { ...base.applications, update },
  };
}

describe("application form panel", () => {
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

  async function render(bridge: JobFinderBridge, record = application(), onChanged = vi.fn()) {
    await act(async () => {
      root.render(
        <BridgeProvider bridge={bridge}>
          <ApplicationForm application={record} onChanged={onChanged} />
        </BridgeProvider>,
      );
    });
  }

  it("opens the form and lists what was filled and what is left for the user", async () => {
    const bridge = bridgeWith(async () => ({
      ok: true,
      provider: "greenhouse",
      filled: ["First Name", "Email"],
      unfilled: [{ label: "Describe a project", reason: "unmapped" }],
    }));
    await render(bridge);

    await act(async () => button(container, "Open form and autofill").click());

    expect(bridge.autofill.start).toHaveBeenCalledWith({ applicationId: "a1" });
    expect(container.textContent).toContain("Recognised as: Greenhouse.");
    expect(container.textContent).toContain("Filled: First Name, Email.");
    expect(container.textContent).toContain("Describe a project: no profile field matches it");
    expect(container.textContent).toContain("Nothing is submitted.");
  });

  it("names a refused start with its own message", async () => {
    await render(bridgeWith(async () => ({ ok: false, code: "invalid-url" })));

    await act(async () => button(container, "Open form and autofill").click());

    expect(container.querySelector("[role='alert']")?.textContent).toBe(
      "The posting has no web link to apply on.",
    );
  });

  it("only moves the application to applied when the user confirms, and only from ready", async () => {
    const update = vi.fn(async () => ({
      ok: true as const,
      application: application({ status: "applied" }),
    }));
    const onChanged = vi.fn();
    const bridge = bridgeWith(
      async () => ({ ok: true, provider: "generic", filled: [], unfilled: [] }),
      update,
    );
    await render(bridge, application(), onChanged);

    await act(async () => button(container, "Open form and autofill").click());
    expect(update).not.toHaveBeenCalled();

    await act(async () => button(container, "I submitted it").click());

    expect(update).toHaveBeenCalledWith({ applicationId: "a1", status: "applied" });
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ status: "applied" }));
    expect(container.textContent).toContain("Marked as applied.");
  });

  it("does not offer to open the form for an application that is not being prepared", async () => {
    await render(
      bridgeWith(async () => ({ ok: true, provider: "generic", filled: [], unfilled: [] })),
      application({ status: "applied" }),
    );

    expect(container.textContent).toContain(
      "Autofill is available while the application is being prepared or ready.",
    );
    expect([...container.querySelectorAll("button")].map((node) => node.textContent)).toEqual([]);
  });

  it("keeps the confirmation disabled while the application is still preparing", async () => {
    const bridge = bridgeWith(async () => ({
      ok: true,
      provider: "lever",
      filled: ["Email"],
      unfilled: [],
    }));
    await render(bridge, application({ status: "preparing" }));

    await act(async () => button(container, "Open form and autofill").click());

    expect(button(container, "I submitted it").disabled).toBe(true);
    expect(container.textContent).toContain(
      "Mark the application ready before you confirm a submission.",
    );
  });
});
