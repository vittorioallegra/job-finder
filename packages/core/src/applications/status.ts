/**
 * Application statuses. `bookmarked` is the user's bookmark of a job: an application with no work
 * done yet, so one table answers both "bookmarked" and "applied".
 */
export const APPLICATION_STATUSES = [
  "bookmarked",
  "preparing",
  "ready",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** The status changes the user may make. A bookmark is removed, not transitioned. */
const TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  bookmarked: ["preparing"],
  preparing: ["ready", "withdrawn"],
  ready: ["preparing", "applied", "withdrawn"],
  applied: ["interviewing", "rejected", "withdrawn"],
  interviewing: ["offer", "rejected", "withdrawn"],
  offer: [],
  rejected: [],
  withdrawn: [],
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Statuses the duplicate guard counts: an application past `preparing`. */
export const GUARD_STATUSES: readonly ApplicationStatus[] = [
  "ready",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
];

/** Statuses the "hide applied" filter hides: the application was submitted, or it ended. */
export const APPLIED_STATUSES: readonly ApplicationStatus[] = [
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
];
