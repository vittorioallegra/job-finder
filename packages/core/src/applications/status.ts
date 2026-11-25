/**
 * Application statuses. `bookmarked` is the user's bookmark of a job: an application with no work
 * done yet, so one table answers both "bookmarked" and "applied".
 */
export const APPLICATION_STATUSES = [
  "bookmarked",
  "preparing",
  "ready",
  "applied",
  "accepted",
  "rejected",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** The status changes the user may make. A bookmark is removed, not transitioned. */
const TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  bookmarked: ["preparing"],
  preparing: ["ready", "applied"],
  ready: ["preparing", "applied"],
  applied: ["accepted", "rejected"],
  accepted: [],
  rejected: [],
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Statuses of an application not yet submitted: it may still be deleted. */
export const UNSENT_STATUSES: readonly ApplicationStatus[] = ["bookmarked", "preparing", "ready"];

export function isUnsent(status: ApplicationStatus): boolean {
  return UNSENT_STATUSES.includes(status);
}

/**
 * What the user sees: the three statuses before submitting are one group, "to send". The other
 * statuses stand for themselves.
 */
export const APPLICATION_GROUPS = ["to-send", "applied", "accepted", "rejected"] as const;
export type ApplicationGroup = (typeof APPLICATION_GROUPS)[number];

export function groupOf(status: ApplicationStatus): ApplicationGroup {
  return isUnsent(status) ? "to-send" : (status as ApplicationGroup);
}

/** Statuses the duplicate guard counts: an application past `preparing`. */
export const GUARD_STATUSES: readonly ApplicationStatus[] = [
  "ready",
  "applied",
  "accepted",
  "rejected",
];

/** Statuses the "hide applied" filter hides: the application was submitted, or it ended. */
export const APPLIED_STATUSES: readonly ApplicationStatus[] = ["applied", "accepted", "rejected"];
