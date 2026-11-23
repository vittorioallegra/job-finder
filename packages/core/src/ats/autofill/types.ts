import type { DocumentKind } from "../../documents/schema";

/** The kinds of control the page script reports. Radio groups and custom widgets are `other`. */
export type FieldKind = "text" | "textarea" | "select" | "checkbox" | "file" | "other";

export interface FormFieldOption {
  value: string;
  text: string;
}

/**
 * One control of an application form, as the page script describes it. Every string is page text:
 * the planner only compares it, never follows it.
 */
export interface FormField {
  /** Id the page script stamped on the control for this run. */
  id: string;
  kind: FieldKind;
  /** The input's type attribute (`email`, `tel`, `text`, ...); empty for other controls. */
  inputType: string;
  name: string;
  label: string;
  autocomplete: string;
  required: boolean;
  /** The control already holds a value. Autofill never overwrites it. */
  hasValue: boolean;
  /** A control hidden from people (a honeypot). It is never filled and never highlighted. */
  honeypot: boolean;
  options: FormFieldOption[];
  /** The `accept` list of a file control. */
  accept: string;
}

/** A value the planner takes from the profile or the stored documents. */
export type FieldKey =
  | "fullName"
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "location"
  | "linkedin"
  | "github"
  | "website"
  | "pronouns"
  | "noticePeriod"
  | "salary"
  | "relocation"
  | "resume"
  | "coverLetter"
  | "standardAnswer";

export type FillAction =
  | { id: string; kind: "text" | "select"; value: string }
  | { id: string; kind: "file"; document: DocumentKind };

/**
 * Why a field is left for the user. `unmapped`: no profile value matches the field; `no-value`: the
 * profile has the value empty; `no-option`: a choice list has no matching option; `not-exported`: the
 * document has no PDF yet; `unsupported`: a control type autofill never fills (checkboxes, radios,
 * custom widgets); `rejected`: the page refused the value when it was set. `ai-no-answer`: the AI
 * found no profile value or draft for the field, so it stays empty; `ai-unverified`: the AI's draft
 * has a number or length the profile does not support, so it is not typed.
 */
export type UnfilledReason =
  | "unmapped"
  | "no-value"
  | "no-option"
  | "not-exported"
  | "unsupported"
  | "rejected"
  | "ai-no-answer"
  | "ai-unverified";

export interface UnfilledField {
  id: string;
  label: string;
  reason: UnfilledReason;
}

export interface FillPlan {
  actions: FillAction[];
  /** Fields autofill did not fill: the page highlights them for the user. */
  unfilled: UnfilledField[];
}
