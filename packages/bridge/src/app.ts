/** The engine process as main sees it: `restarting` between a crash and the next start, `failed` once it gave up. */
export type EngineState = "running" | "restarting" | "failed";

/** A newer release, as the update check found it. The URL is the release page, built by main. */
export interface UpdateNotice {
  version: string;
  url: string;
}

export interface AppStatus {
  engine: EngineState;
  /** Null when the app is up to date, the check is off, or it has not run yet. */
  update: UpdateNotice | null;
}

/**
 * Where a desktop notification sends the user: the job list with only the new jobs. `savedSearchId`
 * is set when the new jobs came from one saved search, and null when they came from several.
 */
export interface OpenNewJobsRequest {
  savedSearchId: string | null;
}

/** Main pushes the status to every window when it changes. */
export const APP_STATUS_CHANNEL = "app:status-changed";
/** Main pushes a request to open the new jobs to the window when a notification is clicked. */
export const APP_OPEN_NEW_JOBS_CHANNEL = "app:open-new-jobs";
