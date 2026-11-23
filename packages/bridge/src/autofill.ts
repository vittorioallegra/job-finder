import { z } from "zod";
import type { AtsId } from "@job-finder/core/ats";
import type { UnfilledReason } from "@job-finder/core/ats/autofill";
import type { AiTestFailureCode } from "./ai";

const identifier = z.string().min(1).max(64);

/**
 * Opens the application's form in its own window and fills what the profile covers. `aiFallback`
 * asks the AI to map the fields the rules leave; `consent` must be true when the AI provider is a
 * cloud service, because the form fields and the profile are sent to it.
 */
export const AutofillStartRequestSchema = z.strictObject({
  applicationId: identifier,
  aiFallback: z.boolean().optional(),
  consent: z.boolean().optional(),
  /** The provider and host the consent was given for (`aiConsentTarget`). */
  consentTarget: z.string().optional(),
});
export type AutofillStartRequest = z.input<typeof AutofillStartRequestSchema>;

/**
 * Why autofill did not start. `invalid-status`: the application is not being prepared or ready;
 * `invalid-url`: the posting has no http or https apply link; `load-failed`: the form page did not
 * load; `debugger-failed`: the window could not be driven; `consent-required`: the AI fallback
 * needs consent for a cloud provider and none was given (no window opens).
 */
export const AUTOFILL_FAILURE_CODES = [
  "not-found",
  "invalid-status",
  "invalid-url",
  "no-profile",
  "consent-required",
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
 * How the AI fallback went. `off`: not asked for; `used`: the AI answered and its fills were applied;
 * `unavailable`: no AI could answer, with the reason, and the rules-based fill still applied.
 */
export type AutofillAiState =
  { state: "off" } | { state: "used" } | { state: "unavailable"; code: AiTestFailureCode };

/**
 * The form window stays open for the user to review and submit. `provider` is the ATS the form
 * was recognised as, or "generic". `drafted` holds the labels of the fields the AI drafted, which
 * the user must check. Labels are the page's own text: shown as text, never run.
 */
export type AutofillStartResult =
  | {
      ok: true;
      provider: AtsId | "generic";
      filled: string[];
      drafted: string[];
      unfilled: AutofillUnfilled[];
      ai: AutofillAiState;
    }
  | { ok: false; code: AutofillFailureCode };
