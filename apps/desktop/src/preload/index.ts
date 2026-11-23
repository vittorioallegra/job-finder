import { contextBridge, ipcRenderer } from "electron";
import type {
  IngestEvent,
  IpcChannel,
  IpcRequest,
  IpcResponse,
  JobFinderBridge,
  SecretName,
} from "@job-finder/bridge";

// Repeats INGEST_PROGRESS_CHANNEL from packages/bridge: the sandboxed preload imports nothing else.
const INGEST_PROGRESS = "ingest:progress";

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
  },
  profile: {
    get: () => invoke("profile:get"),
    save: (profile) => invoke("profile:save", profile),
    importCv: (request) => invoke("profile:import-cv", request),
  },
  discovery: {
    search: (input) => invoke("discovery:search", input),
  },
  companies: {
    list: () => invoke("companies:list"),
    add: (input) => invoke("companies:add", input),
  },
  jobs: {
    list: () => invoke("jobs:list"),
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
