/** A company counts as a duplicate for this many days after the application's last status change. */
export const DUPLICATE_WINDOW_DAYS = 90;

export const DUPLICATE_WINDOW_MS = DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export interface DuplicateCounts {
  /** Applications for the same job, or for a job with the same fingerprint. */
  sameJob: number;
  /** Applications for the same company within the window, not counted in `sameJob`. */
  sameCompany: number;
}

/**
 * The explicit confirmations a preparation needs: two for the same job (the user confirms twice),
 * one for the same company within the window, none otherwise.
 */
export function requiredConfirmations(counts: DuplicateCounts): 0 | 1 | 2 {
  if (counts.sameJob > 0) return 2;
  if (counts.sameCompany > 0) return 1;
  return 0;
}

/** Whether an application's last status change falls inside the duplicate window. */
export function withinDuplicateWindow(statusChangedAt: number, now: number): boolean {
  return statusChangedAt >= now - DUPLICATE_WINDOW_MS;
}
