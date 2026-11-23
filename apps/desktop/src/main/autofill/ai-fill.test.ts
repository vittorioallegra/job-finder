// protects=the autofill AI adapter reports the AI as not configured until a model (and a base URL for an OpenAI-compatible endpoint) is set, treats a remote endpoint as cloud and a local one as not, and hands the saved key, the settings and the draft language to the engine only for the mapping;
// fails_when=an empty model reads as ready, a remote endpoint reads as local, a local endpoint needs consent, the saved key or the wrong language is sent, or an engine failure is reported as a valid answer;
// no_claim=the engine is a scripted double and the settings and secrets are in-memory stand-ins; no provider is called and the key store's encryption is not exercised here;
import { describe, expect, it, vi } from "vitest";
import type { SettingsRepository } from "../settings/repository";
import type { SecretStore } from "../secrets/store";
import { EngineUnavailableError } from "../engine/supervisor";
import { createAutofillAi } from "./ai-fill";
import type { MapFormFieldsRequest } from "../../engine/protocol";
import { emptyProfile } from "@job-finder/core/profile";

function settingsWith(ai: Partial<{ provider: string; model: string; baseUrl: string }>) {
  const value = {
    ai: {
      provider: "openai-compatible",
      model: "local-model",
      baseUrl: "http://localhost:11434/v1",
      contextSize: 8192,
      ...ai,
    },
    ui: { language: "system" },
  };
  return { get: async () => value } as unknown as Pick<SettingsRepository, "get">;
}

const secrets = { read: async () => "sk-saved-key" } as unknown as Pick<SecretStore, "read">;

describe("createAutofillAi", () => {
  it("is not configured without a model, or without a base URL for an OpenAI-compatible endpoint", async () => {
    const engine = { mapFormFields: vi.fn() };
    const noModel = createAutofillAi({
      settings: settingsWith({ model: "  " }),
      secrets,
      engine,
      language: async () => "en",
    });
    const noUrl = createAutofillAi({
      settings: settingsWith({ baseUrl: "" }),
      secrets,
      engine,
      language: async () => "en",
    });

    expect(await noModel.status()).toEqual({ state: "not-configured" });
    expect(await noUrl.status()).toEqual({ state: "not-configured" });
  });

  it("treats a hosted endpoint as cloud and a loopback endpoint as local", async () => {
    const engine = { mapFormFields: vi.fn() };
    const hosted = createAutofillAi({
      settings: settingsWith({ provider: "anthropic", baseUrl: "" }),
      secrets,
      engine,
      language: async () => "en",
    });
    const local = createAutofillAi({
      settings: settingsWith({ baseUrl: "http://localhost:11434/v1" }),
      secrets,
      engine,
      language: async () => "en",
    });

    expect(await hosted.status()).toMatchObject({ state: "ready", cloud: true });
    expect(await local.status()).toMatchObject({ state: "ready", cloud: false });
  });

  it("sends the saved key and the draft language to the engine, and returns its answer", async () => {
    const engine = {
      mapFormFields: vi.fn(async (_request: MapFormFieldsRequest) => ({
        ok: true as const,
        answers: [],
      })),
    };
    const ai = createAutofillAi({
      settings: settingsWith({}),
      secrets,
      engine,
      language: async (applicationId) => (applicationId === "a1" ? "it" : "en"),
    });

    const outcome = await ai.map({
      applicationId: "a1",
      profile: emptyProfile(),
      fields: [],
      consent: false,
    });

    expect(outcome).toEqual({ ok: true, answers: [] });
    const request = engine.mapFormFields.mock.calls[0]?.[0];
    expect(request?.language).toBe("it");
    expect(request?.ai.config).toMatchObject({
      provider: "openai-compatible",
      model: "local-model",
      apiKey: "sk-saved-key",
    });
  });

  it("sends nothing to a cloud provider the user has not agreed to, even if the settings changed after the check", async () => {
    // protects=the profile and form fields reach a cloud provider only with consent, checked again when the call is made; fails_when=settings switched to a cloud provider after the consent check still get the profile; no_claim=the consent prompt;
    const engine = { mapFormFields: vi.fn(async () => ({ ok: true as const, answers: [] })) };
    const ai = createAutofillAi({
      settings: settingsWith({ provider: "anthropic", model: "claude-test", baseUrl: "" }),
      secrets,
      engine,
      language: async () => "en",
    });

    const input = { applicationId: "a1", profile: emptyProfile(), fields: [] };
    expect(await ai.map({ ...input, consent: false })).toMatchObject({ ok: false });
    expect(engine.mapFormFields).not.toHaveBeenCalled();
    expect(await ai.map({ ...input, consent: true, consentTarget: "openai" })).toMatchObject({
      ok: false,
    });
    expect(await ai.map({ ...input, consent: true, consentTarget: "anthropic" })).toMatchObject({
      ok: true,
    });
  });

  it("reports an engine that cannot answer as engine-unavailable, and any other throw as unknown", async () => {
    const unavailable = createAutofillAi({
      settings: settingsWith({}),
      secrets,
      engine: {
        mapFormFields: async () => {
          throw new EngineUnavailableError("crashed");
        },
      },
      language: async () => "en",
    });
    const broken = createAutofillAi({
      settings: settingsWith({}),
      secrets,
      engine: {
        mapFormFields: async () => {
          throw new Error("boom");
        },
      },
      language: async () => "en",
    });

    const input = { applicationId: "a1", profile: emptyProfile(), fields: [], consent: false };
    expect(await unavailable.map(input)).toEqual({ ok: false, code: "engine-unavailable" });
    expect(await broken.map(input)).toEqual({ ok: false, code: "unknown" });
  });
});
