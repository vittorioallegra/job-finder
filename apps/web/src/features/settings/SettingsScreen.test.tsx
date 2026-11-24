// protects=the settings screen loads the saved values, saves only valid changes through the bridge, retries after a failed read, and never shows a stored key value; Linux hides launch at login; keys are kept without the system keychain; the AI connection test saves the changes on screen first, then shows the model or the AI unavailable reason; Ollama is set up from its installed models without a key field, with a context slider up to the model's limit; each provider keeps its own key; the context size shows only for a server and a search key only while its service is on;
// fails_when=a value is sent without validation, a key value is rendered, a failed read shows a blank form, Linux shows launch at login, a failed AI test shows no reason, the test reads settings older than the screen, Ollama asks for a key, saves an unusable provider or hides why its models are missing;
// no_claim=visual layout, keyboard focus order and the real OS keychain are not checked here.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_APP_SETTINGS,
  GEMINI_BASE_URL,
  OLLAMA_BASE_URL,
  type JobFinderBridge,
} from "@job-finder/bridge";
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

  it("sets up Ollama from its installed models, with no key field", async () => {
    const memory = createMemoryBridge({
      models: {
        ok: true,
        models: [
          { id: "gemma3:4b", label: null, sizeBytes: 3_300_000_000, contextLength: 131_072 },
          { id: "qwen3:8b", label: null, sizeBytes: 5_200_000_000, contextLength: 40_960 },
        ],
      },
    });
    const models = vi.fn(memory.ai.models);
    const update = vi.fn(memory.settings.update);
    await render({
      ...memory,
      ai: { ...memory.ai, models },
      settings: { ...memory.settings, update },
    });
    expect(container.textContent).toContain("API key");

    await act(async () => {
      setInputValue(field(container, "Provider"), "ollama");
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 450)));

    expect(models).toHaveBeenLastCalledWith({ source: "ollama", baseUrl: OLLAMA_BASE_URL });
    expect(container.textContent).not.toContain("API key");
    expect(container.textContent).toContain("2 models installed in Ollama.");
    const model = field(container, "Model");
    expect(model).toBeInstanceOf(HTMLSelectElement);
    expect(model.value).toBe("gemma3:4b");
    // The context slider starts at 32k and ends at the chosen model's limit.
    expect(container.textContent).toContain("32,768 tokens");
    expect(container.textContent).toContain("128k");
    await act(async () => {
      setInputValue(model, "qwen3:8b");
    });
    expect(container.textContent).toContain("up to 40,960 tokens");
    const slider = field(container, "Longest text per request") as HTMLInputElement;
    expect(slider.type).toBe("range");
    await act(async () => {
      setInputValue(slider, slider.max);
    });
    expect(container.textContent).toContain("40,960 tokens");
    await act(async () => {
      button(container, "Save settings").click();
    });
    await act(async () => {});
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        ai: expect.objectContaining({
          provider: "openai-compatible",
          model: "qwen3:8b",
          baseUrl: OLLAMA_BASE_URL,
          contextSize: 40_960,
        }),
      }),
    );
  });

  it("saves Gemini at Google's address with a key field and no base URL", async () => {
    const memory = createMemoryBridge();
    const update = vi.fn(memory.settings.update);
    await render({ ...memory, settings: { ...memory.settings, update } });
    await act(async () => {
      setInputValue(field(container, "Provider"), "gemini");
    });
    expect(container.textContent).toContain("API key");
    expect(container.textContent).not.toContain("Base URL");
    await act(async () => {
      setInputValue(field(container, "Model"), "gemini-flash");
    });
    await act(async () => {
      button(container, "Save settings").click();
    });
    await act(async () => {});
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        ai: expect.objectContaining({
          provider: "openai-compatible",
          model: "gemini-flash",
          baseUrl: GEMINI_BASE_URL,
        }),
      }),
    );
  });

  it("picks a hosted model from the provider's list and clears it on a provider switch", async () => {
    const memory = createMemoryBridge({
      settings: {
        ...DEFAULT_APP_SETTINGS,
        ai: {
          ...DEFAULT_APP_SETTINGS.ai,
          provider: "openai-compatible",
          model: "qwen3:8b",
          baseUrl: OLLAMA_BASE_URL,
        },
      },
      models: {
        ok: true,
        models: [{ id: "claude-a", label: "Claude A", sizeBytes: null, contextLength: null }],
      },
    });
    const models = vi.fn(memory.ai.models);
    await render({ ...memory, ai: { ...memory.ai, models } });
    await act(async () => {
      setInputValue(field(container, "Provider"), "anthropic");
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 450)));

    expect(models).toHaveBeenLastCalledWith({ source: "anthropic", baseUrl: "" });
    const model = field(container, "Model");
    expect(model).toBeInstanceOf(HTMLSelectElement);
    expect(model.value).toBe("");
    expect([...(model as HTMLSelectElement).options].map((option) => option.text)).toEqual([
      "Choose a model",
      "Claude A",
    ]);
    expect(container.textContent).not.toContain("qwen3:8b");
    expect(container.textContent).not.toContain(OLLAMA_BASE_URL);
  });

  it("says how to start Ollama when it does not answer", async () => {
    await render(
      createMemoryBridge({
        settings: {
          ...DEFAULT_APP_SETTINGS,
          ai: {
            ...DEFAULT_APP_SETTINGS.ai,
            provider: "openai-compatible",
            baseUrl: OLLAMA_BASE_URL,
          },
        },
        models: { ok: false, code: "unreachable" },
      }),
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 450)));
    expect(field(container, "Provider").value).toBe("ollama");
    expect(container.textContent).toContain(
      `Ollama is not answering at ${OLLAMA_BASE_URL}. Open the Ollama app, then refresh the list.`,
    );
    expect(field(container, "Model")).toBeInstanceOf(HTMLInputElement);
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

  it("keeps a key for each provider: a key saved for one is not shown as saved for another", async () => {
    const memory = createMemoryBridge();
    const set = vi.fn(memory.secrets.set);
    await render({ ...memory, secrets: { ...memory.secrets, set } });
    await act(async () => {
      setInputValue(field(container, "API key"), "sk-anthropic-test");
    });
    await act(async () => {
      button(container, "Save key").click();
    });
    await act(async () => {});
    expect(set).toHaveBeenCalledWith("ai.apiKey.anthropic", "sk-anthropic-test");
    expect(container.textContent).toContain("A key is saved.");

    await act(async () => {
      setInputValue(field(container, "Provider"), "openai");
    });
    expect(container.textContent).toContain("No key saved.");
    await act(async () => {
      setInputValue(field(container, "Provider"), "ollama");
    });
    expect(container.textContent).not.toContain("API key");
    await act(async () => {
      setInputValue(field(container, "Provider"), "anthropic");
    });
    expect(container.textContent).toContain("A key is saved.");
  });

  it("asks for the context size only for a server, and for a search key only while its service is on", async () => {
    await render(createMemoryBridge());
    expect(container.textContent).not.toContain("Longest text per request");
    await act(async () => {
      setInputValue(field(container, "Provider"), "ollama");
    });
    expect(container.textContent).toContain("Longest text per request");

    expect(container.textContent).not.toContain("Brave Search key");
    await act(async () => {
      (field(container, "Brave Search") as HTMLInputElement).click();
    });
    expect(container.textContent).toContain("Brave Search key");
    expect(container.textContent).toContain("Paste a key, or this service is skipped.");
    // One service at a time: choosing Brave leaves DuckDuckGo off.
    expect((field(container, "DuckDuckGo") as HTMLInputElement).checked).toBe(false);
  });

  it("hides launch at login on Linux, and asks no keyring there", async () => {
    await render(createMemoryBridge({ platform: "linux" }));
    expect(container.textContent).not.toContain("Launch at login");
    expect(container.textContent).not.toContain("keyring");
  });

  it("shows launch at login outside Linux", async () => {
    await render(createMemoryBridge({ platform: "darwin" }));
    expect(container.textContent).toContain("Launch at login");
  });

  it("tests the AI connection and explains an unavailable AI with the reason", async () => {
    const memory = createMemoryBridge({ aiTest: { ok: false, code: "invalid-key" } });
    const testConnection = vi.fn(memory.ai.testConnection);
    await render({ ...memory, ai: { ...memory.ai, testConnection } });
    await act(async () => {
      button(container, "Test connection").click();
    });
    await act(async () => {});
    expect(testConnection).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("AI unavailable: the provider rejected the API key.");
  });

  it("adds the technical detail to an unexpected failure", async () => {
    await render(
      createMemoryBridge({ aiTest: { ok: false, code: "unknown", detail: "HTTP 400 bad_param" } }),
    );
    await act(async () => {
      button(container, "Test connection").click();
    });
    await act(async () => {});
    expect(container.textContent).toContain(
      "AI unavailable: unexpected error (HTTP 400 bad_param).",
    );
  });

  it("saves the changes on screen before testing the connection", async () => {
    const memory = createMemoryBridge({ aiTest: { ok: true, model: "claude-test" } });
    const calls: string[] = [];
    const update = vi.fn(async (patch: Parameters<typeof memory.settings.update>[0]) => {
      calls.push("update");
      return memory.settings.update(patch);
    });
    const testConnection = vi.fn(async () => {
      calls.push("test");
      return memory.ai.testConnection();
    });
    await render({
      ...memory,
      settings: { ...memory.settings, update },
      ai: { ...memory.ai, testConnection },
    });
    await act(async () => {
      setInputValue(field(container, "Check saved searches every"), "48");
    });
    expect(container.textContent).toContain("Unsaved changes.");
    await act(async () => {
      button(container, "Test connection").click();
    });
    await act(async () => {});
    expect(calls).toEqual(["update", "test"]);
    expect(update.mock.calls[0]?.[0].scheduler?.intervalHours).toBe(48);
    expect(container.textContent).not.toContain("Unsaved changes.");

    await act(async () => {
      button(container, "Test connection").click();
    });
    await act(async () => {});
    expect(calls).toEqual(["update", "test", "test"]);
  });

  it("does not test when the changes on screen cannot be saved", async () => {
    const memory = createMemoryBridge();
    const testConnection = vi.fn(memory.ai.testConnection);
    await render({ ...memory, ai: { ...memory.ai, testConnection } });
    await act(async () => {
      setInputValue(field(container, "Check saved searches every"), "0");
    });
    await act(async () => {
      button(container, "Test connection").click();
    });
    await act(async () => {});
    expect(testConnection).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Nothing was saved.");
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
