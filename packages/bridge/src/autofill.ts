import { z } from "zod";
import type { AtsId } from "@job-finder/core/ats";
import type { UnfilledReason } from "@job-finder/core/ats/autofill";

const identifier = z.string().min(1).max(64);

/** Opens the application's form in its own window and fills what the profile covers. */
export const AutofillStartRequestSchema = z.strictObject({ applicationId: identifier });
export type AutofillStartRequest = z.input<typeof AutofillStartRequestSchema>;

/**
 * Why autofill did not start. `invalid-status`: the application is not being prepared or ready;
 * `invalid-url`: the posting has no http or https apply link; `load-failed`: the form page did not
 * load; `debugger-failed`: the window could not be driven.
 */
export const AUTOFILL_FAILURE_CODES = [
  "not-found",
  "invalid-status",
  "invalid-url",
  "no-profile",
  "load-failed",
  "debugger-failed",
  "autofill-failed",
] as const;
export type AutofillFailureCode = (typeof AUTOFILL_FAILURE_CODES)[number];

export interface AutofillUnfilled {
  label: string;
  reason: UnfilledReason;
}

/**
 * The form window stays open for the user to review and submit. `provider` is the ATS the form
 * was recognised as, or "generic". Labels are the page's own text: shown as text, never run.
 */
export type AutofillStartResult =
  | { ok: true; provider: AtsId | "generic"; filled: string[]; unfilled: AutofillUnfilled[] }
  | { ok: false; code: AutofillFailureCode };
