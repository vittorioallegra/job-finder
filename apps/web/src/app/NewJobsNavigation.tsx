import { useEffect } from "react";
import type { OpenNewJobsRequest } from "@job-finder/bridge";
import { newJobsPath } from "../features/jobs/new-jobs-link";
import { useBridge } from "../lib/bridge/BridgeContext";
import { router } from "./router";

/**
 * Opens the new jobs when a notification is clicked. A click made before this screen was ready is
 * waiting in main and is taken on mount; taking clears it, so each click opens the jobs once.
 */
export function NewJobsNavigation() {
  const bridge = useBridge();
  useEffect(() => {
    const open = (request: OpenNewJobsRequest) => {
      void router.navigate(newJobsPath(request));
    };
    let active = true;
    bridge.app.takePendingOpen().then(
      (request) => {
        if (active && request) open(request);
      },
      () => {},
    );
    const unsubscribe = bridge.app.onOpenNewJobs((request) => {
      void bridge.app.takePendingOpen().catch(() => null);
      open(request);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge]);
  return null;
}
