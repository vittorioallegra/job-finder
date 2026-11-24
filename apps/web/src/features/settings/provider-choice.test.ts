// protects=the Gemini and Ollama menu entries are saved as the OpenAI-compatible provider at their address and read back as themselves; the Ollama menu entry is saved as the OpenAI-compatible provider at Ollama's address and read back as Ollama, and switching entries starts the model and address over;
// fails_when=Ollama is saved as a provider the settings schema rejects, a hosted provider keeps a base URL, a model name or address is carried into another provider, or a saved Ollama setup reopens as the generic entry;
// no_claim=how the menu renders and whether Ollama really runs at that address are not checked here.
import { describe, expect, it } from "vitest";
import { GEMINI_BASE_URL, OLLAMA_BASE_URL } from "@job-finder/bridge";
import { aiChoiceFromSettings, aiSettingsFromChoice, switchAiChoice } from "./provider-choice";

describe("AI provider choice", () => {
  it("saves Ollama as the OpenAI-compatible provider and reads it back as Ollama", () => {
    const saved = aiSettingsFromChoice({ choice: "ollama", model: "qwen3:8b", baseUrl: "" });
    expect(saved).toEqual({
      provider: "openai-compatible",
      model: "qwen3:8b",
      baseUrl: OLLAMA_BASE_URL,
    });
    expect(aiChoiceFromSettings(saved)).toBe("ollama");
    expect(
      aiChoiceFromSettings({ provider: "openai-compatible", baseUrl: "http://localhost:1234/v1" }),
    ).toBe("openai-compatible");
    expect(aiChoiceFromSettings({ provider: "anthropic", baseUrl: "" })).toBe("anthropic");
  });

  it("drops the base URL for a hosted provider", () => {
    expect(
      aiSettingsFromChoice({ choice: "openai", model: "m", baseUrl: "http://localhost:11434/v1" }),
    ).toEqual({ provider: "openai", model: "m", baseUrl: "" });
  });

  it("starts the model and address over on every provider switch", () => {
    expect(
      switchAiChoice({ choice: "anthropic", model: "claude-model", baseUrl: "" }, "ollama"),
    ).toEqual({ choice: "ollama", model: "", baseUrl: OLLAMA_BASE_URL });
    expect(
      switchAiChoice({ choice: "ollama", model: "qwen3:8b", baseUrl: OLLAMA_BASE_URL }, "openai"),
    ).toEqual({ choice: "openai", model: "", baseUrl: "" });
    expect(
      switchAiChoice(
        { choice: "ollama", model: "qwen3:8b", baseUrl: OLLAMA_BASE_URL },
        "openai-compatible",
      ),
    ).toEqual({ choice: "openai-compatible", model: "", baseUrl: "" });
  });
});

describe("Gemini choice", () => {
  it("saves Gemini at Google's address and reads it back as Gemini", () => {
    const saved = aiSettingsFromChoice({ choice: "gemini", model: "gemini-flash", baseUrl: "" });
    expect(saved).toEqual({
      provider: "openai-compatible",
      model: "gemini-flash",
      baseUrl: GEMINI_BASE_URL,
    });
    expect(aiChoiceFromSettings(saved)).toBe("gemini");
  });

  it("fills Google's address on pick", () => {
    expect(switchAiChoice({ choice: "openai", model: "gpt", baseUrl: "" }, "gemini")).toEqual({
      choice: "gemini",
      model: "",
      baseUrl: GEMINI_BASE_URL,
    });
  });
});
