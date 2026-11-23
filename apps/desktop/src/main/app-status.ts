import type { AppStatus, EngineState, UpdateNotice } from "@job-finder/bridge";

export interface AppStatusStore {
  get(): AppStatus;
  setEngine(engine: EngineState): void;
  setUpdate(update: UpdateNotice | null): void;
}

/** Holds the status the windows and the tray show. `onChange` runs only when a value actually changes. */
export function createAppStatusStore(
  initial: AppStatus,
  onChange: (status: AppStatus) => void,
): AppStatusStore {
  let status: AppStatus = { ...initial };
  const publish = (next: AppStatus) => {
    if (JSON.stringify(next) === JSON.stringify(status)) return;
    status = next;
    onChange({ ...status });
  };
  return {
    get: () => ({ ...status }),
    setEngine: (engine) => publish({ ...status, engine }),
    setUpdate: (update) => publish({ ...status, update }),
  };
}
