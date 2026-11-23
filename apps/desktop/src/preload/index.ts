import { contextBridge, ipcRenderer } from "electron";
import type {
  IpcChannel,
  IpcRequest,
  IpcResponse,
  JobFinderBridge,
  SecretName,
} from "@job-finder/bridge";

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
};

contextBridge.exposeInMainWorld("jobFinder", Object.freeze(api));
