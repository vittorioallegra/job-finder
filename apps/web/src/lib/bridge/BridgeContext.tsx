import { createContext, useContext, type ReactNode } from "react";
import type { JobFinderBridge } from "@job-finder/bridge";
import { demoBridgeOptions } from "./demo";
import { createMemoryBridge } from "./memory";

/**
 * The desktop preload's bridge when present; an in-memory stand-in in a plain browser (dev, tests).
 * In `pnpm dev`, opening the page with `?demo` fills the stand-in with made-up sample data.
 */
export function resolveWindowBridge(): JobFinderBridge {
  const exposed = (globalThis as { jobFinder?: JobFinderBridge }).jobFinder;
  if (exposed) return exposed;
  const platform = /linux/i.test(navigator.userAgent) ? "linux" : "darwin";
  return createMemoryBridge(
    import.meta.env.DEV && demoRequested() ? { ...demoBridgeOptions(), platform } : { platform },
  );
}

/** `?demo` turns the sample data on for this tab, `?demo=off` turns it off again. */
function demoRequested(): boolean {
  const param = new URLSearchParams(window.location.search).get("demo");
  try {
    if (param === "off") sessionStorage.removeItem("job-finder.demo");
    else if (param !== null) sessionStorage.setItem("job-finder.demo", "1");
    return sessionStorage.getItem("job-finder.demo") === "1";
  } catch {
    return param !== null && param !== "off";
  }
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
