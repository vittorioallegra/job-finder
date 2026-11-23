import type { OpenNewJobsRequest } from "@job-finder/bridge";

export interface OpenNewJobsRelay {
  /** Delivers a request to the window now and keeps it until a window takes it. */
  open(request: OpenNewJobsRequest): void;
  /** Returns the waiting request, if any, and clears it. */
  take(): OpenNewJobsRequest | null;
}

/**
 * A click on a notification can arrive while no window is ready to show the jobs (the window was
 * closed, or is still loading). The request waits here until a window takes it.
 */
export function createOpenNewJobsRelay(
  deliver: (request: OpenNewJobsRequest) => void,
): OpenNewJobsRelay {
  let waiting: OpenNewJobsRequest | null = null;
  return {
    open(request) {
      waiting = request;
      deliver(request);
    },
    take() {
      const request = waiting;
      waiting = null;
      return request;
    },
  };
}
