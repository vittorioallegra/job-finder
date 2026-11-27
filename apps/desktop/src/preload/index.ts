import { contextBridge, ipcRenderer } from "electron";
import type {
  AppStatus,
  IngestEvent,
  IpcChannel,
  IpcRequest,
  IpcResponse,
  JobFinderBridge,
  OpenNewJobsRequest,
  SecretName,
} from "@job-finder/bridge";

// Repeats INGEST_PROGRESS_CHANNEL from packages/bridge: the sandboxed preload imports nothing else.
const INGEST_PROGRESS = "ingest:progress";
// Repeats APP_STATUS_CHANNEL and APP_OPEN_NEW_JOBS_CHANNEL from packages/bridge, for the same reason.
const APP_STATUS_CHANGED = "app:status-changed";
const APP_OPEN_NEW_JOBS = "app:open-new-jobs";

// The sandboxed preload may import only `electron` and types, so channel names are written out
// here. Typing `channel` as `IpcChannel` keeps them in step with the contract in packages/bridge.
function invoke<C extends IpcChannel>(
  channel: C,
  payload?: IpcRequest<C>,
): Promise<IpcResponse<C>> {
  return ipcRenderer.invoke(channel, payload) as Promise<IpcResponse<C>>;
}

const api: JobFinderBridge = {
  platform: process.platform,
  settings: {
    get: () => invoke("settings:get"),
    update: (patch) => invoke("settings:update", patch),
  },
  secrets: {
    status: () => invoke("secrets:status"),
    set: (name: SecretName, value: string) => invoke("secrets:set", { name, value }),
    clear: (name: SecretName) => invoke("secrets:clear", { name }),
  },
  ai: {
    testConnection: () => invoke("ai:test-connection"),
    models: (request: IpcRequest<"ai:models">) => invoke("ai:models", request),
  },
  app: {
    status: () => invoke("app:status"),
    onStatusChange: (listener: (status: AppStatus) => void) => {
      const handler = (_event: unknown, payload: unknown) => listener(payload as AppStatus);
      ipcRenderer.on(APP_STATUS_CHANGED, handler);
      return () => {
        ipcRenderer.removeListener(APP_STATUS_CHANGED, handler);
      };
    },
    openUpdate: () => invoke("app:open-update"),
    takePendingOpen: () => invoke("app:take-pending-open"),
    onOpenNewJobs: (listener: (request: OpenNewJobsRequest) => void) => {
      const handler = (_event: unknown, payload: unknown) =>
        listener(payload as OpenNewJobsRequest);
      ipcRenderer.on(APP_OPEN_NEW_JOBS, handler);
      return () => {
        ipcRenderer.removeListener(APP_OPEN_NEW_JOBS, handler);
      };
    },
  },
  profile: {
    get: () => invoke("profile:get"),
    save: (profile) => invoke("profile:save", profile),
    importCv: (request) => invoke("profile:import-cv", request),
    cancelImport: () => invoke("profile:cancel-import"),
  },
  autofill: {
    start: (request) => invoke("autofill:start", request),
  },
  documents: {
    get: (request) => invoke("documents:get", request),
    generate: (request) => invoke("documents:generate", request),
    setLanguage: (request) => invoke("documents:set-language", request),
    save: (request) => invoke("documents:save", request),
    exportPdf: (request) => invoke("documents:export", request),
    preview: (request) => invoke("documents:preview", request),
  },
  scores: {
    start: (input) => invoke("scores:start", input),
  },
  discovery: {
    fromProfile: () => invoke("discovery:from-profile"),
    backgroundStatus: () => invoke("discovery:background-status"),
  },
  companies: {
    list: () => invoke("companies:list"),
    summary: () => invoke("companies:summary"),
    directory: () => invoke("companies:directory"),
    remove: (companyId: string) => invoke("companies:remove", { companyId }),
    excluded: () => invoke("companies:excluded"),
    restore: (companyId: string) => invoke("companies:restore", { companyId }),
  },
  jobs: {
    list: (request) => invoke("jobs:list", request),
    detail: (request) => invoke("jobs:detail", request),
    flag: (request) => invoke("jobs:flag", request),
  },
  applications: {
    list: () => invoke("applications:list"),
    detail: (request) => invoke("applications:detail", request),
    bookmark: (request) => invoke("applications:bookmark", request),
    check: (request) => invoke("applications:check", request),
    start: (request) => invoke("applications:start", request),
    update: (request) => invoke("applications:update", request),
    remove: (request) => invoke("applications:remove", request),
    exportCsv: () => invoke("applications:export"),
  },
  ingest: {
    start: (companyId) =>
      invoke("ingest:start", companyId === undefined ? undefined : { companyId }),
    cancel: (runId: string) => invoke("ingest:cancel", { runId }),
    latest: () => invoke("ingest:latest"),
    onProgress: (listener: (event: IngestEvent) => void) => {
      const handler = (_event: unknown, payload: unknown) => listener(payload as IngestEvent);
      ipcRenderer.on(INGEST_PROGRESS, handler);
      return () => {
        ipcRenderer.removeListener(INGEST_PROGRESS, handler);
      };
    },
  },
};

contextBridge.exposeInMainWorld("jobFinder", Object.freeze(api));
