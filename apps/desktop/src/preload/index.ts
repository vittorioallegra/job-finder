import { contextBridge } from "electron";
import type { JobFinderBridge } from "@job-finder/bridge";

// Minimal surface for the scaffold. The typed IPC contract arrives with the bridge step.
const api: JobFinderBridge = { platform: process.platform };

contextBridge.exposeInMainWorld("jobFinder", Object.freeze(api));
