// protects=a CV goes to the engine only with the key and the file, and a cloud provider receives it only after the user consents, while a loopback endpoint does not need consent;
// fails_when=a cloud import without consent reaches the engine, a loopback import is refused for missing consent, the key is missing from the engine request, or an engine failure is passed on as a raw error;
// no_claim=the consent note text and the renderer checkbox are not checked here; the engine's extraction is covered in packages/core.
import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "@job-finder/bridge";
import type { CvImportRequest as EngineCvImportRequest } from "@job-finder/core/cv";
import { EngineUnavailableError } from "../engine/supervisor";
import type { SecretStore } from "../secrets/store";
import type { SettingsRepository } from "../settings/repository";
import { createCvImportService, type CvEngine } from "./cv-import";

function services(
  ai: Partial<AppSettings["ai"]>,
  engine: Omit<CvEngine, "cancelCvImports"> & Partial<Pick<CvEngine, "cancelCvImports">>,
) {
  const settings: SettingsRepository = {
    get: async () => ({ ...DEFAULT_APP_SETTINGS, ai: { ...DEFAULT_APP_SETTINGS.ai, ...ai } }),
    update: async () => DEFAULT_APP_SETTINGS,
  };
  const secrets = { read: async () => "sk-cv-test" } as unknown as SecretStore;
  return createCvImportService({
    settings,
    secrets,
    engine: { cancelCvImports: () => undefined, ...engine },
  });
}

const upload = (consent: boolean, consentTarget = "openai") => ({
  fileName: "cv.txt",
  bytes: new TextEncoder().encode("Maria Rossi"),
  consent,
  consentTarget,
});

describe("CV import service", () => {
  it("refuses a cloud provider without consent and never reaches the engine", async () => {
    const calls: EngineCvImportRequest[] = [];
    const engine: Omit<CvEngine, "cancelCvImports"> = {
      importCv: async (request) => {
        calls.push(request);
        return { ok: false, code: "unknown" };
      },
    };
    const service = services({ provider: "anthropic", model: "claude-test" }, engine);

    expect(await service.importCv(upload(false))).toEqual({ ok: false, code: "consent-required" });
    expect(calls).toHaveLength(0);
  });

  it("sends a consented cloud import to the engine with the key and the settings", async () => {
    const calls: EngineCvImportRequest[] = [];
    const engine: Omit<CvEngine, "cancelCvImports"> = {
      importCv: async (request) => {
        calls.push(request);
        return { ok: false, code: "invalid-output" };
      },
    };
    const service = services({ provider: "openai", model: "gpt-test", contextSize: 4096 }, engine);

    expect(await service.importCv(upload(true))).toEqual({ ok: false, code: "invalid-output" });
    expect(calls).toEqual([
      expect.objectContaining({
        fileName: "cv.txt",
        contextSize: 4096,
        config: expect.objectContaining({ provider: "openai", apiKey: "sk-cv-test" }),
      }),
    ]);
  });

  it("does not require consent for a loopback OpenAI-compatible endpoint", async () => {
    const engine: Omit<CvEngine, "cancelCvImports"> = {
      importCv: async () => ({ ok: false, code: "model-not-found" }),
    };
    const service = services(
      { provider: "openai-compatible", model: "llama", baseUrl: "http://localhost:11434/v1" },
      engine,
    );

    expect(await service.importCv(upload(false))).toEqual({ ok: false, code: "model-not-found" });
  });

  it("reports an unavailable engine as a code and any other failure as unknown", async () => {
    const unavailable = services(
      { provider: "openai-compatible", baseUrl: "http://localhost:1/v1", model: "m" },
      {
        importCv: async () => {
          throw new EngineUnavailableError("crashed");
        },
      },
    );
    const broken = services(
      { provider: "openai-compatible", baseUrl: "http://localhost:1/v1", model: "m" },
      {
        importCv: async () => {
          throw new Error("secret parser detail");
        },
      },
    );

    expect(await unavailable.importCv(upload(false))).toEqual({
      ok: false,
      code: "engine-unavailable",
    });
    const brokenResult = await broken.importCv(upload(false));
    expect(brokenResult).toEqual({ ok: false, code: "unknown" });
    expect(JSON.stringify(brokenResult)).not.toContain("secret parser detail");
  });
});
