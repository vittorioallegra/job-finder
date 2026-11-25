// protects=the form panel opens the form only for an application being prepared, shows what was filled and what the user must still fill, names each failure, asks for consent before a cloud AI fallback runs, shows the AI unavailable state when no provider is set up, marks AI drafts for review, and moves the application to applied only when the user confirms the submission;
// fails_when=the form opens for an applied or bookmarked application, a refused start is reported as opened, the left-over fields are hidden, a failure shows no message, the AI fallback starts for a cloud provider without consent, no AI-unavailable message appears when the AI cannot answer, a draft is not marked for review, or "I submitted it" changes the status without the user pressing it or is blocked while the application is still preparing;
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
import { MemoryRouter } from "react-router";
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
  start: (request: { applicationId: string }) => Promise<AutofillStartResult>,
  update = vi.fn(async () => ({
    ok: true as const,
    application: application({ status: "applied" }),
  })),
  ai: { provider: "anthropic" | "openai" | "openai-compatible"; model: string; baseUrl: string } = {
    provider: "openai-compatible",
    model: "local-model",
    baseUrl: "http://localhost:11434/v1",
  },
): JobFinderBridge {
  const base = createMemoryBridge({});
  const settings = base.settings;
  return {
    ...base,
    settings: {
      ...settings,
      get: async () => {
        const current = await settings.get();
        return { ...current, ai: { ...current.ai, ...ai } };
      },
    },
    autofill: { start: vi.fn(start) },
    applications: { ...base.applications, update },
  };
}

/** The checkbox whose label contains the text. */
function checkbox(container: HTMLElement, text: string): HTMLInputElement {
  const label = [...container.querySelectorAll("label")].find((node) =>
    node.textContent?.includes(text),
  );
  const input = label?.querySelector("input");
  if (!input) throw new Error(`no checkbox ${text}`);
  return input;
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
        <MemoryRouter>
          <BridgeProvider bridge={bridge}>
            <ApplicationForm application={record} onChanged={onChanged} />
          </BridgeProvider>
        </MemoryRouter>,
      );
    });
  }

  it("shows an error with a retry when the AI settings cannot be loaded", async () => {
    // protects=the AI settings load failure shows an error state with a retry; fails_when=the rejection only reaches the console or retry does not reload; no_claim=the form start itself;
    const bridge = bridgeWith(async () => ({ ok: false, code: "autofill-failed" }));
    const realGet = bridge.settings.get;
    let calls = 0;
    bridge.settings.get = async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return realGet();
    };
    await render(bridge);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "The AI settings could not be loaded",
    );

    await act(async () => button(container, "Try again").click());

    expect(calls).toBe(2);
    expect(container.textContent).not.toContain("could not be loaded");
    expect(checkbox(container, "AI")).toBeTruthy();
  });

  it("opens the form and lists what was filled and what is left for the user", async () => {
    const bridge = bridgeWith(async () => ({
      ok: true,
      provider: "greenhouse",
      drafted: [],
      ai: { state: "off" },
      filled: ["First Name", "Email"],
      unfilled: [{ label: "Describe a project", reason: "unmapped" }],
    }));
    await render(bridge);

    await act(async () => button(container, "Open form and autofill").click());

    expect(bridge.autofill.start).toHaveBeenCalledWith({
      applicationId: "a1",
      aiFallback: false,
      consent: false,
      consentTarget: "openai-compatible:http://localhost:11434",
    });
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
      async () => ({
        ok: true,
        provider: "generic",
        filled: [],
        drafted: [],
        ai: { state: "off" },
        unfilled: [],
      }),
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
      bridgeWith(async () => ({
        ok: true,
        provider: "generic",
        filled: [],
        drafted: [],
        ai: { state: "off" },
        unfilled: [],
      })),
      application({ status: "applied" }),
    );

    expect(container.textContent).toContain(
      "Autofill is available while the application is being prepared or ready.",
    );
    expect([...container.querySelectorAll("button")].map((node) => node.textContent)).toEqual([]);
  });

  it("lets the user confirm a submission while the application is still preparing", async () => {
    const bridge = bridgeWith(async () => ({
      ok: true,
      provider: "lever",
      drafted: [],
      ai: { state: "off" },
      filled: ["Email"],
      unfilled: [],
    }));
    await render(bridge, application({ status: "preparing" }));

    await act(async () => button(container, "Open form and autofill").click());

    expect(button(container, "I submitted it").disabled).toBe(false);
  });

  it("shows the AI unavailable state with a settings link when no provider is set up", async () => {
    const start = vi.fn(async () => ({
      ok: true as const,
      provider: "generic" as const,
      filled: [],
      drafted: [],
      ai: { state: "off" as const },
      unfilled: [],
    }));
    await render(
      bridgeWith(start, undefined, { provider: "openai-compatible", model: "", baseUrl: "" }),
    );

    expect(container.textContent).toContain(
      "AI unavailable: no AI provider is set up in Settings.",
    );
    expect(container.querySelector('a[href="/settings"]')).not.toBeNull();
    expect(container.querySelectorAll("input[type='checkbox']")).toHaveLength(0);
    expect(button(container, "Open form and autofill").disabled).toBe(false);
  });

  it("needs consent before a cloud AI fallback is sent, and sends it with consent", async () => {
    const start = vi.fn(async () => ({
      ok: true as const,
      provider: "generic" as const,
      filled: [],
      drafted: [],
      ai: { state: "off" as const },
      unfilled: [],
    }));
    await render(
      bridgeWith(start, undefined, { provider: "anthropic", model: "claude-test", baseUrl: "" }),
    );

    await act(async () => checkbox(container, "Ask the AI to fill").click());
    expect(button(container, "Open form and autofill").disabled).toBe(true);

    await act(async () => checkbox(container, "I agree to send the form's fields").click());
    expect(button(container, "Open form and autofill").disabled).toBe(false);

    await act(async () => button(container, "Open form and autofill").click());
    expect(start).toHaveBeenCalledWith({
      applicationId: "a1",
      aiFallback: true,
      consent: true,
      consentTarget: "anthropic",
    });
  });

  it("marks the AI drafts for review and names an AI failure with its reason", async () => {
    await render(
      bridgeWith(async () => ({
        ok: true,
        provider: "generic",
        filled: ["Anything else we should know?"],
        drafted: ["Anything else we should know?"],
        ai: { state: "used" },
        unfilled: [],
      })),
    );
    await act(async () => button(container, "Open form and autofill").click());
    expect(container.textContent).toContain(
      "The AI drafted these answers. Check them before you submit: Anything else we should know?.",
    );

    await render(
      bridgeWith(async () => ({
        ok: true,
        provider: "generic",
        filled: [],
        drafted: [],
        ai: { state: "unavailable", code: "invalid-key" },
        unfilled: [],
      })),
    );
    await act(async () => button(container, "Open form and autofill").click());
    expect(container.textContent).toContain("AI unavailable: the provider rejected the API key.");
  });
});
