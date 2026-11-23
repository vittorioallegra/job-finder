// protects=onboarding saves the AI provider before Continue unlocks, asks for consent before a CV goes to a cloud provider but not to a local endpoint, shows AI unavailable when the engine fails, and opens the review with the extracted draft;
// fails_when=Continue unlocks with unsaved AI edits, a cloud import is enabled without consent, a local endpoint asks for consent, an engine failure shows no reason, or the extracted draft is not shown for review;
// no_claim=the real file dialog, the engine's extraction quality and the OS keychain are not exercised; the bridge is an in-memory double.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS, type AppSettings, type CvImportResult } from "@job-finder/bridge";
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
  return { ...DEFAULT_APP_SETTINGS, ai: { ...DEFAULT_APP_SETTINGS.ai, ...ai } };
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

  async function render(options: BridgeOptions) {
    const bridge = createMemoryBridge(options);
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
  }

  /** Renders with the given AI settings already saved and moves past the AI step. */
  async function goToCv(options: BridgeOptions = {}) {
    await render({ settings: withAi({ model: "test-model", provider: "anthropic" }), ...options });
    await act(async () => button(container, "Save provider").click());
    await act(async () => button(container, "Continue to the CV").click());
  }

  it("keeps Continue locked while the AI settings have unsaved edits", async () => {
    await render({});
    await act(async () => setValue(labelled(container, "Model"), "claude-new"));
    expect(button(container, "Continue to the CV").disabled).toBe(true);

    await act(async () => button(container, "Save provider").click());
    expect(button(container, "Continue to the CV").disabled).toBe(false);
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
