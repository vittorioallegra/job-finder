// protects=the IPC payload schemas accept valid settings and secret requests and reject out-of-bounds or unknown values before main uses them;
// fails_when=an invalid interval, unknown section or key, non-HTTP base URL, unknown secret name or empty key is accepted, or defaults stop being valid;
// no_claim=the schemas do not check that a base URL is reachable or that a model name exists at the provider.
import { describe, expect, it } from "vitest";
import {
  AppSettingsPatchSchema,
  AppSettingsSchema,
  DEFAULT_APP_SETTINGS,
  IPC_REQUEST_SCHEMAS,
  SecretSetRequestSchema,
} from "./index";

describe("settings contract", () => {
  it("accepts the defaults as a complete settings object", () => {
    expect(AppSettingsSchema.parse(DEFAULT_APP_SETTINGS)).toEqual(DEFAULT_APP_SETTINGS);
  });

  it("rejects a scheduler interval outside 1 to 168 hours", () => {
    const patch = (intervalHours: number) => ({ scheduler: { intervalHours } });
    expect(AppSettingsPatchSchema.safeParse(patch(0)).success).toBe(false);
    expect(AppSettingsPatchSchema.safeParse(patch(169)).success).toBe(false);
    expect(AppSettingsPatchSchema.safeParse(patch(1.5)).success).toBe(false);
    expect(AppSettingsPatchSchema.safeParse(patch(168)).success).toBe(true);
  });

  it("rejects unknown sections and unknown keys inside a section", () => {
    expect(AppSettingsPatchSchema.safeParse({ unknown: { a: 1 } }).success).toBe(false);
    expect(
      AppSettingsPatchSchema.safeParse({ ui: { language: "it", theme: "dark" } }).success,
    ).toBe(false);
  });

  it("accepts only http and https base URLs, or an empty one", () => {
    const withUrl = (baseUrl: string) => ({ ai: { baseUrl } });
    expect(AppSettingsPatchSchema.safeParse(withUrl("http://localhost:11434/v1")).success).toBe(
      true,
    );
    expect(AppSettingsPatchSchema.safeParse(withUrl("")).success).toBe(true);
    expect(AppSettingsPatchSchema.safeParse(withUrl("file:///etc/passwd")).success).toBe(false);
    expect(AppSettingsPatchSchema.safeParse(withUrl("not a url")).success).toBe(false);
  });

  it("requires a base URL for the OpenAI-compatible provider", () => {
    const settings = {
      ...DEFAULT_APP_SETTINGS,
      ai: { ...DEFAULT_APP_SETTINGS.ai, provider: "openai-compatible" as const, baseUrl: "" },
    };
    expect(AppSettingsSchema.safeParse(settings).success).toBe(false);
  });
});

describe("secret and channel contract", () => {
  it("rejects secret names outside the fixed list and empty values", () => {
    expect(
      SecretSetRequestSchema.safeParse({ name: "ai.apiKey.openai", value: "sk-test" }).success,
    ).toBe(true);
    expect(SecretSetRequestSchema.safeParse({ name: "db.password", value: "x" }).success).toBe(
      false,
    );
    expect(
      SecretSetRequestSchema.safeParse({ name: "ai.apiKey.openai", value: "   " }).success,
    ).toBe(false);
  });

  it("defines a schema for every channel, with no payload for the read channels", () => {
    expect(IPC_REQUEST_SCHEMAS["settings:get"].safeParse(undefined).success).toBe(true);
    expect(IPC_REQUEST_SCHEMAS["secrets:status"].safeParse(undefined).success).toBe(true);
    expect(IPC_REQUEST_SCHEMAS["settings:get"].safeParse({}).success).toBe(false);
  });
});
