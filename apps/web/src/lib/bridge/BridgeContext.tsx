import { createContext, useContext, type ReactNode } from "react";
import type { JobFinderBridge } from "@job-finder/bridge";
import { createMemoryBridge } from "./memory";

/** The desktop preload's bridge when present; an in-memory stand-in in a plain browser (dev, tests). */
export function resolveWindowBridge(): JobFinderBridge {
  const exposed = (globalThis as { jobFinder?: JobFinderBridge }).jobFinder;
  return (
    exposed ??
    createMemoryBridge({ platform: /linux/i.test(navigator.userAgent) ? "linux" : "darwin" })
  );
}

const BridgeContext = createContext<JobFinderBridge | null>(null);

export function BridgeProvider({
  bridge,
  children,
}: {
  bridge?: JobFinderBridge;
  children: ReactNode;
}) {
  return (
    <BridgeContext.Provider value={bridge ?? resolveWindowBridge()}>
      {children}
    </BridgeContext.Provider>
  );
}

/** Returns the bridge from the nearest provider; screens never reach `window` directly. */
export function useBridge(): JobFinderBridge {
  const bridge = useContext(BridgeContext);
  if (!bridge) {
    throw new Error("useBridge must be used inside BridgeProvider");
  }
  return bridge;
}
