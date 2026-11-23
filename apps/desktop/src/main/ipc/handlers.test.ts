// protects=every IPC call passes the top-level app-origin sender check and the payload schema before reaching a service, and the settings update triggers the Linux opt-in follow-up;
// fails_when=a call from a sub-frame or foreign origin reaches a service, an invalid payload is passed on, or a channel in the contract is not registered;
// no_claim=Electron's own sender identity and the preload's exposure are not exercised here.
import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS } from "@job-finder/bridge";
import type { SecretStore } from "../secrets/store";
import type { SettingsRepository } from "../settings/repository";
import {
  handleInvoke,
  isTrustedSender,
  registerIpcHandlers,
  type InvokeSender,
  type IpcServices,
} from "./handlers";

const APP_ORIGIN = "app://renderer";

function topFrame(url = "app://renderer/"): InvokeSender {
  return { senderFrame: { url, parent: null } };
}

function spyServices() {
  const calls: string[] = [];
  const settings: SettingsRepository = {
    get: async () => {
      calls.push("settings.get");
      return DEFAULT_APP_SETTINGS;
    },
    update: async () => {
      calls.push("settings.update");
      return DEFAULT_APP_SETTINGS;
    },
  };
  const secrets = {
    status: async () => {
      calls.push("secrets.status");
      return {
        storage: { mode: "encrypted" as const, optInRequired: false },
        keys: {
          "ai.apiKey": false,
          "search.brave": false,
          "search.tavily": false,
          "search.serper": false,
        },
      };
    },
    set: async () => {
      calls.push("secrets.set");
      throw new Error("unexpected");
    },
    clear: async () => {
      calls.push("secrets.clear");
      throw new Error("unexpected");
    },
    read: async () => null,
    onBasicTextAllowedChanged: async () => {
      calls.push("secrets.onBasicTextAllowedChanged");
    },
  } as unknown as SecretStore;
  const ai = {
    testConnection: async () => {
      calls.push("ai.testConnection");
      return { ok: false as const, code: "not-configured" as const };
    },
  };
  const services: IpcServices = { settings, secrets, ai };
  return { services, calls };
}

describe("IPC sender and payload guard", () => {
  it("accepts only the top-level frame at the renderer origin", () => {
    expect(isTrustedSender(topFrame(), APP_ORIGIN)).toBe(true);
    expect(isTrustedSender(topFrame("https://example.com/"), APP_ORIGIN)).toBe(false);
    expect(
      isTrustedSender(
        { senderFrame: { url: "app://renderer/", parent: { url: "app://renderer/" } } },
        APP_ORIGIN,
      ),
    ).toBe(false);
    expect(isTrustedSender({ senderFrame: null }, APP_ORIGIN)).toBe(false);
  });

  it("rejects a foreign sender before any service runs", async () => {
    const { services, calls } = spyServices();
    await expect(
      handleInvoke(
        "secrets:status",
        services,
        topFrame("https://example.com/"),
        undefined,
        APP_ORIGIN,
      ),
    ).rejects.toThrow("untrusted sender");
    expect(calls).toEqual([]);
  });

  it("rejects an invalid payload before the service is called", async () => {
    const { services, calls } = spyServices();
    await expect(
      handleInvoke(
        "secrets:set",
        services,
        topFrame(),
        { name: "db.password", value: "x" },
        APP_ORIGIN,
      ),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("runs the service for a valid payload from the app window", async () => {
    const { services, calls } = spyServices();
    const result = await handleInvoke("settings:get", services, topFrame(), undefined, APP_ORIGIN);
    expect(result).toEqual(DEFAULT_APP_SETTINGS);
    expect(calls).toEqual(["settings.get"]);
  });

  it("re-checks the Linux opt-in after a settings update that names it", async () => {
    const { services, calls } = spyServices();
    await handleInvoke(
      "settings:update",
      services,
      topFrame(),
      { secrets: { allowBasicText: true } },
      APP_ORIGIN,
    );
    expect(calls).toEqual(["settings.update", "secrets.onBasicTextAllowedChanged"]);
  });

  it("runs the AI connection test only for the app window", async () => {
    const { services, calls } = spyServices();
    await expect(
      handleInvoke(
        "ai:test-connection",
        services,
        topFrame("https://example.com/"),
        undefined,
        APP_ORIGIN,
      ),
    ).rejects.toThrow("untrusted sender");
    expect(calls).toEqual([]);

    await handleInvoke("ai:test-connection", services, topFrame(), undefined, APP_ORIGIN);
    expect(calls).toEqual(["ai.testConnection"]);
  });

  it("registers every channel in the contract", () => {
    const registered: string[] = [];
    registerIpcHandlers(
      { handle: (channel) => void registered.push(channel) },
      spyServices().services,
      APP_ORIGIN,
    );
    expect(registered.sort()).toEqual(
      [
        "ai:test-connection",
        "secrets:clear",
        "secrets:set",
        "secrets:status",
        "settings:get",
        "settings:update",
      ].sort(),
    );
  });
});
