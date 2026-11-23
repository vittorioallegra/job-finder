// protects=the settings screen loads the saved values, saves only valid changes through the bridge, retries after a failed read, and never shows a stored key value; Linux shows the keyring opt-in and hides launch at login; the AI connection test shows the model or the AI unavailable reason;
// fails_when=a value is sent without validation, a key value is rendered, a failed read shows a blank form, Linux shows launch at login, or a failed AI test shows no reason;
// no_claim=visual layout, keyboard focus order and the real OS keychain are not checked here.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_SETTINGS, type JobFinderBridge } from "@job-finder/bridge";
import { BridgeProvider } from "../../lib/bridge/BridgeContext";
import { createMemoryBridge } from "../../lib/bridge/memory";
import { i18n } from "../../lib/i18n";
import { SettingsScreen } from "./SettingsScreen";

function setInputValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype =
    element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(
    new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
  );
}

function field(container: HTMLElement, labelText: string): HTMLInputElement | HTMLSelectElement {
  const label = [...container.querySelectorAll("label")].find((node) =>
    node.textContent?.includes(labelText),
  );
  const control = label?.htmlFor ? container.ownerDocument.getElementById(label.htmlFor) : null;
  if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) {
    throw new Error(`no control labelled ${labelText}`);
  }
  return control;
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

describe("settings screen", () => {
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
            <SettingsScreen />
          </BridgeProvider>
        </MemoryRouter>,
      );
    });
    await act(async () => {});
  }

  it("shows a loading state, then the saved values", async () => {
    const bridge = createMemoryBridge({
      settings: { ...DEFAULT_APP_SETTINGS, scheduler: { intervalHours: 12 } },
    });
    act(() => {
      root.render(
        <MemoryRouter>
          <BridgeProvider bridge={bridge}>
            <SettingsScreen />
          </BridgeProvider>
        </MemoryRouter>,
      );
    });
    expect(container.textContent).toContain("Loading settings");
    await act(async () => {});
    expect((field(container, "Check saved searches every") as HTMLInputElement).value).toBe("12");
    expect(container.querySelector("h1")?.textContent).toBe("Settings");
  });

  it("shows an error with a retry that loads the settings", async () => {
    const memory = createMemoryBridge();
    const get = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(memory.settings.get);
    await render({ ...memory, settings: { ...memory.settings, get } });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded");
    await act(async () => {
      button(container, "Try again").click();
    });
    await act(async () => {});
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(field(container, "Model")).toBeInstanceOf(HTMLInputElement);
  });

  it("saves a changed value as a patch and confirms", async () => {
    const memory = createMemoryBridge();
    const update = vi.fn(memory.settings.update);
    await render({ ...memory, settings: { ...memory.settings, update } });
    await act(async () => {
      setInputValue(field(container, "Model"), "llama3.1");
    });
    await act(async () => {
      button(container, "Save settings").click();
    });
    await act(async () => {});
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ ai: expect.objectContaining({ model: "llama3.1" }) }),
    );
    expect(container.textContent).toContain("Settings saved.");
  });

  it("refuses an out-of-range interval without calling the bridge", async () => {
    const memory = createMemoryBridge();
    const update = vi.fn(memory.settings.update);
    await render({ ...memory, settings: { ...memory.settings, update } });
    await act(async () => {
      setInputValue(field(container, "Check saved searches every"), "500");
    });
    await act(async () => {
      button(container, "Save settings").click();
    });
    await act(async () => {});
    expect(update).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Nothing was saved");
  });

  it("saves a key, clears the input and never shows the value", async () => {
    const memory = createMemoryBridge();
    await render(memory);
    const keyInput = field(container, "API key") as HTMLInputElement;
    expect(keyInput.type).toBe("password");
    await act(async () => {
      setInputValue(keyInput, "sk-visible-test-value");
    });
    await act(async () => {
      button(container, "Save key").click();
    });
    await act(async () => {});
    expect(keyInput.value).toBe("");
    expect(container.textContent).toContain("A key is saved.");
    expect(container.innerHTML).not.toContain("sk-visible-test-value");
  });

  it("shows the Linux keyring opt-in and hides launch at login", async () => {
    const memory = createMemoryBridge({
      platform: "linux",
      storage: { mode: "session-only", optInRequired: true },
    });
    const update = vi.fn(memory.settings.update);
    await render({ ...memory, settings: { ...memory.settings, update } });
    expect(container.textContent).toContain("No system keyring found");
    expect(container.textContent).not.toContain("Launch at login");
    const optIn = field(container, "Allow storing keys") as HTMLInputElement;
    await act(async () => {
      optIn.click();
    });
    await act(async () => {});
    expect(update).toHaveBeenCalledWith({ secrets: { allowBasicText: true } });
  });

  it("shows launch at login outside Linux", async () => {
    await render(createMemoryBridge({ platform: "darwin" }));
    expect(container.textContent).toContain("Launch at login");
  });

  it("tests the AI connection and explains an unavailable AI with the reason", async () => {
    const memory = createMemoryBridge({ aiTest: { ok: false, code: "invalid-key" } });
    const testConnection = vi.fn(memory.ai.testConnection);
    await render({ ...memory, ai: { testConnection } });
    await act(async () => {
      button(container, "Test connection").click();
    });
    await act(async () => {});
    expect(testConnection).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("AI unavailable: the provider rejected the API key.");
  });

  it("reports the model when the connection test passes", async () => {
    await render(createMemoryBridge({ aiTest: { ok: true, model: "claude-test" } }));
    await act(async () => {
      button(container, "Test connection").click();
    });
    await act(async () => {});
    expect(container.textContent).toContain("Connected to claude-test.");
  });
});
