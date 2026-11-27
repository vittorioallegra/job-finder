// protects=onboarding saves the AI provider before Continue unlocks, with the same context controls as Settings, asks for consent before a CV goes to a cloud provider but not to a local endpoint, shows AI unavailable when the engine fails, shows one progress message with a spinner while the CV is read, locks manual setup during the import and stops it on demand or when the user goes back, lets each step go back, and opens the review with the extracted draft;
// fails_when=the first run does not start with no AI, no AI still asks for a CV, Continue unlocks with unsaved AI edits, a cloud import is enabled without consent, a local endpoint asks for consent, an engine failure shows no reason, or the extracted draft is not shown for review;
// no_claim=the real file dialog, the engine's extraction quality and the OS keychain are not exercised; the bridge is an in-memory double.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type CvImportResult,
  type JobFinderBridge,
} from "@job-finder/bridge";
import { BridgeProvider } from "../../lib/bridge/BridgeContext";
import { createMemoryBridge } from "../../lib/bridge/memory";
import { i18n } from "../../lib/i18n";
import { OnboardingScreen } from "./OnboardingScreen";

type BridgeOptions = Parameters<typeof createMemoryBridge>[0];

function setValue(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function labelled(container: HTMLElement, text: string): HTMLInputElement {
  const label = [...container.querySelectorAll("label")].find((node) =>
    node.textContent?.trim().startsWith(text),
  );
  const element = label?.htmlFor ? container.ownerDocument.getElementById(label.htmlFor) : null;
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`no input labelled ${text}`);
  }
  return element;
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

function chooseFile(container: HTMLElement) {
  const input = container.querySelector<HTMLInputElement>("#onboarding-cv-file");
  if (!input) {
    throw new Error("no file input");
  }
  const file = new File(["Maria Rossi"], "cv.txt", { type: "text/plain" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function tickConsent(container: HTMLElement) {
  container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
}

const extraction: CvImportResult = {
  ok: true,
  extraction: {
    contact: { fullName: "Maria Rossi", email: "", phone: "", location: "" },
    headline: "Backend Engineer",
    summary: "",
    experience: [],
    education: [],
    skills: [],
    languages: [],
    certifications: [],
    links: [],
  },
  warnings: [],
};

function withAi(ai: Partial<AppSettings["ai"]>): AppSettings {
  return { ...DEFAULT_APP_SETTINGS, ai: { ...DEFAULT_APP_SETTINGS.ai, enabled: true, ...ai } };
}

describe("onboarding", () => {
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

  async function render(
    options: BridgeOptions,
    adjust?: (bridge: JobFinderBridge) => JobFinderBridge,
  ) {
    const memory = createMemoryBridge(options);
    const bridge = adjust ? adjust(memory) : memory;
    await act(async () => {
      root.render(
        <MemoryRouter>
          <BridgeProvider bridge={bridge}>
            <OnboardingScreen />
          </BridgeProvider>
        </MemoryRouter>,
      );
    });
    await act(async () => {});
    return bridge;
  }

  /** Renders with the given AI settings already saved and moves past the AI step. */
  async function goToCv(options: BridgeOptions = {}) {
    await render({ settings: withAi({ model: "test-model", provider: "anthropic" }), ...options });
    await act(async () => button(container, "Save provider").click());
    await act(async () => button(container, "Continue to the CV").click());
  }

  it("starts with no AI, and continuing skips the CV import straight to filling in the profile", async () => {
    await render({ settings: DEFAULT_APP_SETTINGS });
    expect(container.querySelector("select")?.value).toBe("none");
    expect(container.textContent).not.toContain("Test connection");
    expect(container.textContent).not.toContain("Model");

    await act(async () => button(container, "Continue to the CV").click());

    expect(container.querySelector("#onboarding-cv-file")).toBeNull();
    expect(container.textContent).toContain("Check your profile");
    await act(async () => button(container, "Back").click());
    expect(container.textContent).toContain("AI provider");
  });

  it("keeps Continue locked while the AI settings have unsaved edits", async () => {
    await render({});
    await act(async () => setValue(labelled(container, "Model"), "claude-new"));
    expect(button(container, "Continue to the CV").disabled).toBe(true);

    await act(async () => button(container, "Save provider").click());
    expect(button(container, "Continue to the CV").disabled).toBe(false);
  });

  it("offers the same context slider as Settings for Ollama and saves it", async () => {
    const bridge = await render({
      settings: withAi({
        provider: "openai-compatible",
        baseUrl: "http://localhost:11434/v1",
        model: "qwen3:8b",
        contextSize: 16_384,
      }),
      models: {
        ok: true,
        models: [{ id: "qwen3:8b", label: null, sizeBytes: null, contextLength: 40_960 }],
      },
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 450)));
    const slider = labelled(container, "Longest text per request");
    expect(slider.type).toBe("range");
    await act(async () => setValue(slider, slider.max));
    expect(button(container, "Continue to the CV").disabled).toBe(true);
    await act(async () => button(container, "Save provider").click());
    expect((await bridge.settings.get()).ai.contextSize).toBe(40_960);
  });

  it("asks for consent before a CV goes to a cloud provider", async () => {
    await goToCv({ settings: withAi({ provider: "openai", model: "gpt-test" }) });
    expect(container.textContent).toContain("To read your CV, its text is sent to OpenAI");

    await act(async () => chooseFile(container));
    expect(button(container, "Import CV").disabled).toBe(true);
    await act(async () => tickConsent(container));
    expect(button(container, "Import CV").disabled).toBe(false);
  });

  it("does not ask for consent for a local OpenAI-compatible endpoint", async () => {
    await goToCv({
      settings: withAi({
        provider: "openai-compatible",
        model: "llama",
        baseUrl: "http://localhost:11434/v1",
      }),
    });
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();

    await act(async () => chooseFile(container));
    expect(button(container, "Import CV").disabled).toBe(false);
  });

  it("reports AI unavailable with the reason when the engine cannot run the import", async () => {
    await goToCv({ cvImport: { ok: false, code: "engine-unavailable" } });
    await act(async () => chooseFile(container));
    await act(async () => tickConsent(container));
    await act(async () => button(container, "Import CV").click());

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "AI unavailable: the AI worker is not running.",
    );
  });

  it("shows one progress message with a spinner and the time so far while the CV is read", async () => {
    await render(
      { settings: withAi({ model: "test-model", provider: "anthropic" }) },
      (bridge) => ({
        ...bridge,
        profile: { ...bridge.profile, importCv: () => new Promise<CvImportResult>(() => {}) },
      }),
    );
    await act(async () => button(container, "Save provider").click());
    await act(async () => button(container, "Continue to the CV").click());
    await act(async () => chooseFile(container));
    await act(async () => tickConsent(container));
    await act(async () => button(container, "Import CV").click());

    const importButton = button(container, "Import CV");
    expect(importButton.disabled).toBe(true);
    expect(importButton.querySelector(".animate-spin")).not.toBeNull();
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Reading your CV…");
    expect(status?.textContent).toContain("0 seconds so far");
    expect(container.textContent?.split("Reading your CV…").length).toBe(2);
  });

  it("locks manual setup while the CV is read, stops the import on demand or on leaving, and goes back", async () => {
    let cancels = 0;
    await render(
      { settings: withAi({ model: "test-model", provider: "anthropic" }) },
      (bridge) => ({
        ...bridge,
        profile: {
          ...bridge.profile,
          importCv: () => new Promise<CvImportResult>(() => {}),
          cancelImport: async () => {
            cancels += 1;
          },
        },
      }),
    );
    await act(async () => button(container, "Save provider").click());
    await act(async () => button(container, "Continue to the CV").click());
    await act(async () => chooseFile(container));
    await act(async () => tickConsent(container));
    await act(async () => button(container, "Import CV").click());
    expect(button(container, "Enter the profile by hand").disabled).toBe(true);

    await act(async () => button(container, "Stop").click());
    expect(cancels).toBe(1);
    expect(container.textContent).not.toContain("Reading your CV…");
    expect(button(container, "Enter the profile by hand").disabled).toBe(false);

    await act(async () => button(container, "Import CV").click());
    await act(async () => button(container, "Back").click());
    expect(cancels).toBe(2);
    expect(container.textContent).toContain("Continue to the CV");
  });

  it("goes back from the review to the CV step", async () => {
    await goToCv();
    await act(async () => button(container, "Enter the profile by hand").click());
    expect(container.querySelector("#onboarding-review")).not.toBeNull();
    await act(async () => button(container, "Back").click());
    expect(container.querySelector("#onboarding-review")).toBeNull();
    expect(container.textContent).toContain("Import CV");
  });

  it("opens the review with the extracted headline", async () => {
    await goToCv({ cvImport: extraction });
    await act(async () => chooseFile(container));
    await act(async () => tickConsent(container));
    await act(async () => button(container, "Import CV").click());

    expect(container.querySelector("#onboarding-review")?.textContent).toBe("Check your profile");
    expect(
      container.querySelector<HTMLInputElement>('input[value="Backend Engineer"]'),
    ).not.toBeNull();
  });
});
