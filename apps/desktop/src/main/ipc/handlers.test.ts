// protects=every IPC call passes the top-level app-origin sender check and the payload schema before reaching a service, the settings update triggers the Linux opt-in follow-up and the settings hook, and the app status channels reach the app service;
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
    listModels: async (request: { source: string; baseUrl: string }) => {
      calls.push(`ai.listModels:${request.source}:${request.baseUrl}`);
      return { ok: false as const, code: "unreachable" as const };
    },
  };
  const profile = {
    get: async () => {
      calls.push("profile.get");
      return null;
    },
    save: async () => {
      calls.push("profile.save");
      throw new Error("not reached");
    },
  };
  const cvImport = {
    importCv: async () => {
      calls.push("cvImport.importCv");
      return { ok: false as const, code: "consent-required" as const };
    },
  };
  const repository = {
    listCompanies: async () => {
      calls.push("repository.listCompanies");
      return [];
    },
    addCompany: async () => {
      calls.push("repository.addCompany");
      return { ok: false as const, code: "duplicate-company" as const };
    },
    listJobs: async () => {
      calls.push("repository.listJobs");
      return [];
    },
    jobDetail: async () => {
      calls.push("repository.jobDetail");
      return null;
    },
    setJobFlag: async () => {
      calls.push("repository.setJobFlag");
      return false;
    },
    latestRun: async () => {
      calls.push("repository.latestRun");
      return null;
    },
  };
  const ingestion = {
    start: async () => {
      calls.push("ingestion.start");
      return { ok: false as const, code: "engine-unavailable" as const };
    },
    cancel: (runId: string) => {
      calls.push(`ingestion.cancel:${runId}`);
    },
    handleEngineEvent: () => {},
    handleEngineLost: () => {},
  };
  const discovery = {
    search: async () => {
      calls.push("discovery.search");
      return { ok: false as const, code: "engine-unavailable" as const };
    },
  };
  const services: IpcServices = {
    settings,
    app: {
      status: () => ({ engine: "running", update: null }),
      openUpdate: async () => false,
      takePendingOpen: () => null,
    },
    afterSettingsUpdate: () => {},
    secrets,
    ai,
    profile,
    cvImport,
    repository,
    ingestion,
    discovery,
    scoring: { start: async () => ({ ok: false as const, code: "no-profile" as const }) },
    savedSearches: {
      list: async () => {
        calls.push("savedSearches.list");
        return [];
      },
      save: async () => null,
      delete: async () => {},
    },
    applications: {
      list: async () => {
        calls.push("applications.list");
        return [];
      },
      listDetails: async () => [],
      detail: async () => null,
      bookmark: async ({ jobId, bookmarked }) => {
        calls.push(`applications.bookmark:${jobId}:${String(bookmarked)}`);
        return true;
      },
      check: async () => ({ sameJob: [], sameCompany: [], requiredConfirmations: 0 as const }),
      start: async () => ({ ok: false as const, code: "job-not-found" as const }),
      update: async () => ({ ok: false as const, code: "not-found" as const }),
    },
    autofill: {
      start: async (request: { applicationId: string }) => {
        calls.push(`autofill.start:${request.applicationId}`);
        return { ok: false as const, code: "invalid-status" as const };
      },
    },
    documents: {
      get: async (applicationId: string) => {
        calls.push(`documents.get:${applicationId}`);
        return {
          applicationId,
          cv: null,
          coverLetter: null,
          defaultLanguage: { language: "en" as const, source: "ui" as const },
        };
      },
      generate: async (request: { kind: string }) => {
        calls.push(`documents.generate:${request.kind}`);
        return { ok: false as const, code: "unknown" as const };
      },
      save: async () => ({ ok: false as const, code: "not-found" as const }),
      exportPdf: async (request: { kind: string }) => {
        calls.push(`documents.export:${request.kind}`);
        return { ok: false as const, code: "not-found" as const };
      },
      reveal: async () => false,
    },
    applicationExport: {
      exportCsv: async () => {
        calls.push("applicationExport.exportCsv");
        return { ok: false as const, code: "cancelled" as const };
      },
    },
  };
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

  it("answers the app status channels from the app service and runs the settings hook after an update", async () => {
    const { services } = spyServices();
    const seen: string[] = [];
    services.app = {
      status: () => ({ engine: "failed", update: null }),
      openUpdate: async () => true,
      takePendingOpen: () => ({ savedSearchId: "s1" }),
    };
    services.afterSettingsUpdate = (next) => seen.push(next.app.closeBehavior);

    expect(await handleInvoke("app:status", services, topFrame(), undefined, APP_ORIGIN)).toEqual({
      engine: "failed",
      update: null,
    });
    expect(await handleInvoke("app:open-update", services, topFrame(), undefined, APP_ORIGIN)).toBe(
      true,
    );
    expect(
      await handleInvoke("app:take-pending-open", services, topFrame(), undefined, APP_ORIGIN),
    ).toEqual({ savedSearchId: "s1" });
    await handleInvoke(
      "settings:update",
      services,
      topFrame(),
      { app: { closeBehavior: "quit" } },
      APP_ORIGIN,
    );
    // The hook runs once, with the settings the repository stored.
    expect(seen).toHaveLength(1);
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

  it("validates the source and address before listing models", async () => {
    const { services, calls } = spyServices();
    await expect(
      handleInvoke("ai:models", services, topFrame(), { source: "other", baseUrl: "" }, APP_ORIGIN),
    ).rejects.toThrow();
    expect(calls).toEqual([]);

    await handleInvoke(
      "ai:models",
      services,
      topFrame(),
      { source: "ollama", baseUrl: " http://localhost:11434/v1 " },
      APP_ORIGIN,
    );
    expect(calls).toEqual(["ai.listModels:ollama:http://localhost:11434/v1"]);
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
        "ai:models",
        "ai:test-connection",
        "app:open-update",
        "app:status",
        "app:take-pending-open",
        "applications:bookmark",
        "applications:check",
        "applications:detail",
        "applications:export",
        "applications:list",
        "applications:start",
        "applications:update",
        "autofill:start",
        "companies:add",
        "companies:list",
        "discovery:search",
        "documents:export",
        "documents:generate",
        "documents:get",
        "documents:reveal",
        "documents:save",
        "ingest:cancel",
        "ingest:latest",
        "ingest:start",
        "jobs:detail",
        "jobs:flag",
        "jobs:list",
        "profile:get",
        "profile:import-cv",
        "profile:save",
        "saved-searches:delete",
        "saved-searches:list",
        "saved-searches:save",
        "scores:start",
        "secrets:clear",
        "secrets:set",
        "secrets:status",
        "settings:get",
        "settings:update",
      ].sort(),
    );
  });

  it("routes the document channels to the document service with their ids and kinds", async () => {
    const { services, calls } = spyServices();
    await handleInvoke("documents:get", services, topFrame(), { applicationId: "a1" }, APP_ORIGIN);
    await handleInvoke(
      "documents:generate",
      services,
      topFrame(),
      { applicationId: "a1", kind: "cv", consent: false },
      APP_ORIGIN,
    );
    await handleInvoke(
      "documents:export",
      services,
      topFrame(),
      { applicationId: "a1", kind: "cover-letter" },
      APP_ORIGIN,
    );
    expect(calls.slice(-3)).toEqual([
      "documents.get:a1",
      "documents.generate:cv",
      "documents.export:cover-letter",
    ]);
  });

  it("routes the ingestion channels to their services, and passes a cancel's run id on", async () => {
    const { services, calls } = spyServices();
    await handleInvoke("companies:list", services, topFrame(), undefined, APP_ORIGIN);
    await handleInvoke(
      "jobs:list",
      services,
      topFrame(),
      { filter: {}, sort: "affinity" },
      APP_ORIGIN,
    );
    await handleInvoke("jobs:detail", services, topFrame(), { jobId: "j1" }, APP_ORIGIN);
    await handleInvoke(
      "jobs:flag",
      services,
      topFrame(),
      { jobId: "j1", viewed: true },
      APP_ORIGIN,
    );
    await handleInvoke("saved-searches:list", services, topFrame(), undefined, APP_ORIGIN);
    await handleInvoke("ingest:latest", services, topFrame(), undefined, APP_ORIGIN);
    await handleInvoke("ingest:start", services, topFrame(), undefined, APP_ORIGIN);
    await handleInvoke("ingest:cancel", services, topFrame(), { runId: "run-7" }, APP_ORIGIN);
    await handleInvoke(
      "applications:bookmark",
      services,
      topFrame(),
      { jobId: "j2", bookmarked: true },
      APP_ORIGIN,
    );
    await handleInvoke("applications:export", services, topFrame(), undefined, APP_ORIGIN);
    expect(calls).toEqual([
      "repository.listCompanies",
      "repository.listJobs",
      "repository.jobDetail",
      "repository.setJobFlag",
      "savedSearches.list",
      "repository.latestRun",
      "ingestion.start",
      "ingestion.cancel:run-7",
      "applications.bookmark:j2:true",
      "applicationExport.exportCsv",
    ]);
  });

  it("keeps an invalid profile and a CV upload without consent away from their services", async () => {
    const { services, calls } = spyServices();
    const invalidProfile = { headline: "x", links: [{ label: "x", url: "file:///etc/passwd" }] };
    await expect(
      handleInvoke("profile:save", services, topFrame(), invalidProfile, APP_ORIGIN),
    ).rejects.toThrow();
    await expect(
      handleInvoke(
        "profile:import-cv",
        services,
        topFrame(),
        { fileName: "cv.txt", bytes: "text", consent: true },
        APP_ORIGIN,
      ),
    ).rejects.toThrow();
    expect(calls).not.toContain("profile.save");
    expect(calls).not.toContain("cvImport.importCv");
  });
});
