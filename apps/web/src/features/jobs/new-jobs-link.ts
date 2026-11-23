import type { OpenNewJobsRequest } from "@job-finder/bridge";

/**
 * The job list path a notification click opens: only the new jobs, narrowed to the saved search
 * when the notification named one. The search id is an internal identifier, never a personal value.
 */
export function newJobsPath(request: OpenNewJobsRequest): string {
  const params = new URLSearchParams({ new: "1" });
  if (request.savedSearchId) params.set("saved", request.savedSearchId);
  return `/jobs?${params.toString()}`;
}
