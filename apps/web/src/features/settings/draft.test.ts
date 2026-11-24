// protects=the settings form turns into a valid patch only when every value is inside the shared bounds, and a loaded settings object survives the round trip through the form; hosted providers get a fixed context size and a server keeps the one typed for it;
// fails_when=an empty or out-of-range number is sent to the bridge, or a loaded value is changed on the way through the form;
// no_claim=how the values are rendered as inputs and what the bridge does with the patch are not checked here.
import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS } from "@job-finder/bridge";
import { draftFromSettings, patchFromDraft } from "./draft";

describe("settings draft", () => {
  it("turns loaded settings into a patch that keeps every value", () => {
    const patch = patchFromDraft(draftFromSettings(DEFAULT_APP_SETTINGS));
    expect(patch).toEqual({
      ai: { provider: "anthropic", model: "", baseUrl: "", contextSize: 128_000 },
      search: { duckduckgo: true, brave: false, tavily: false, serper: false },
      ui: { language: "system" },
      notifications: { enabled: true },
      scheduler: { intervalHours: 24 },
      app: { closeBehavior: "ask", launchAtLogin: false },
      updates: { checkEnabled: true },
    });
  });

  it("refuses an empty or out-of-range number instead of sending it", () => {
    const base = draftFromSettings(DEFAULT_APP_SETTINGS);
    expect(patchFromDraft({ ...base, intervalHours: "" })).toBeNull();
    expect(patchFromDraft({ ...base, intervalHours: "169" })).toBeNull();
    expect(patchFromDraft({ ...base, aiProvider: "ollama", aiContextSize: "12.5" })).toBeNull();
  });

  it("sets the context size for hosted providers and keeps the one typed for a server", () => {
    const hosted = draftFromSettings({
      ...DEFAULT_APP_SETTINGS,
      ai: { provider: "openai", model: "m", baseUrl: "", contextSize: 128_000 },
    });
    expect(patchFromDraft(hosted)?.ai?.contextSize).toBe(128_000);
    // Switching to Ollama starts from the usual size, never the hosted one.
    expect(
      patchFromDraft({ ...hosted, aiProvider: "ollama", aiBaseUrl: "http://localhost:11434/v1" })
        ?.ai?.contextSize,
    ).toBe(16_384);
    expect(
      patchFromDraft({
        ...hosted,
        aiProvider: "ollama",
        aiBaseUrl: "http://localhost:11434/v1",
        aiContextSize: "16384",
      })?.ai?.contextSize,
    ).toBe(16384);
  });
});
