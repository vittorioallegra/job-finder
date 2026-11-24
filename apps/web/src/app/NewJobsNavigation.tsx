import { useEffect } from "react";
import { useBridge } from "../lib/bridge/BridgeContext";
import { router } from "./router";

/**
 * Opens the new jobs when a notification is clicked. A click made before this screen was ready is
 * waiting in main and is taken on mount; taking clears it, so each click opens the jobs once.
 */
export function NewJobsNavigation() {
  const bridge = useBridge();
  useEffect(() => {
    const open = () => {
      void router.navigate("/jobs?new=1");
    };
    let active = true;
    bridge.app.takePendingOpen().then(
      (request) => {
        if (active && request) open();
      },
      () => {},
    );
    const unsubscribe = bridge.app.onOpenNewJobs(() => {
      void bridge.app.takePendingOpen().catch(() => null);
      open();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge]);
  return null;
}
