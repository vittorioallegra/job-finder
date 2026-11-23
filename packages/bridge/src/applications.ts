import { z } from "zod";
import { APPLICATION_STATUSES, type ApplicationStatus } from "@job-finder/core/applications";

export {
  APPLICATION_STATUSES,
  canTransition,
  type ApplicationStatus,
} from "@job-finder/core/applications";

const identifier = z.string().min(1).max(64);

export const ApplicationBookmarkRequestSchema = z.strictObject({
  jobId: identifier,
  bookmarked: z.boolean(),
});

export type ApplicationBookmarkRequest = z.input<typeof ApplicationBookmarkRequestSchema>;

export const ApplicationCheckRequestSchema = z.strictObject({ jobId: identifier });

export type ApplicationCheckRequest = z.input<typeof ApplicationCheckRequestSchema>;

/**
 * Starts preparing a job. `confirmations` is how many explicit confirmations the user gave the
 * duplicate warning (0, 1 or 2); the warning is in `ApplicationCheckRequest`.
 */
export const ApplicationStartRequestSchema = z.strictObject({
  jobId: identifier,
  confirmations: z.number().int().min(0).max(2).default(0),
});

export type ApplicationStartRequest = z.input<typeof ApplicationStartRequestSchema>;

/** A status change, a note, or both. A note alone adds an event at the current status. */
export const ApplicationUpdateRequestSchema = z
  .strictObject({
    applicationId: identifier,
    status: z.enum(APPLICATION_STATUSES).optional(),
    note: z.string().trim().min(1).max(2000).optional(),
  })
  .refine((request) => request.status !== undefined || request.note !== undefined, {
    message: "An update needs a status or a note",
  });

export type ApplicationUpdateRequest = z.input<typeof ApplicationUpdateRequestSchema>;

export const ApplicationDetailRequestSchema = z.strictObject({ applicationId: identifier });

export type ApplicationDetailRequest = z.input<typeof ApplicationDetailRequestSchema>;

/** One application as the list and the board show it. */
export interface ApplicationSummary {
  id: string;
  jobId: string;
  jobTitle: string;
  companyId: string;
  companyName: string;
  status: ApplicationStatus;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds, the last status change. */
  statusChangedAt: number;
  jobUrl: string;
  applyUrl: string;
}

export interface ApplicationEvent {
  id: string;
  status: ApplicationStatus;
  note: string | null;
  /** Epoch milliseconds. */
  at: number;
}

export interface ApplicationDetail extends ApplicationSummary {
  /** Oldest first. */
  events: ApplicationEvent[];
}

/** An application that the duplicate guard names. */
export interface DuplicateApplication {
  id: string;
  jobId: string;
  jobTitle: string;
  companyName: string;
  status: ApplicationStatus;
  statusChangedAt: number;
}

export interface DuplicateCheck {
  sameJob: DuplicateApplication[];
  sameCompany: DuplicateApplication[];
  /** The explicit confirmations the preparation needs: 2, 1 or 0. */
  requiredConfirmations: 0 | 1 | 2;
}

export type ApplicationFailureCode =
  "not-found" | "invalid-transition" | "job-not-found" | "duplicate-confirmation-required";

export type ApplicationStartResult =
  | { ok: true; application: ApplicationDetail }
  | { ok: false; code: "job-not-found" }
  | { ok: false; code: "duplicate-confirmation-required"; duplicates: DuplicateCheck };

export type ApplicationUpdateResult =
  | { ok: true; application: ApplicationDetail }
  | { ok: false; code: "not-found" | "invalid-transition" };

export type ApplicationExportResult =
  { ok: true; path: string; count: number } | { ok: false; code: "cancelled" | "write-failed" };
