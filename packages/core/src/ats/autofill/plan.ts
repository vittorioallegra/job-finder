import type { DocumentKind } from "../../documents/schema";
import type { Profile } from "../../profile/schema";
import { fieldKeyOf, normalizeLabel, type FormProvider } from "./rules";
import type {
  FieldKey,
  FillAction,
  FillPlan,
  FormField,
  UnfilledField,
  UnfilledReason,
} from "./types";

/** What autofill may fill from: the profile, and which documents have a PDF to upload. */
export interface AutofillSources {
  profile: Profile;
  documents: Record<DocumentKind, boolean>;
}

const YES = ["yes", "si", "oui", "ja"];
const NO = ["no", "non", "nein"];

/** The option whose text is the given one (after normalizing), or whose value equals it. */
function optionFor(field: FormField, value: string): string | undefined {
  const wanted = normalizeLabel(value);
  const match = field.options.find(
    (option) => option.value === value || normalizeLabel(option.text) === wanted,
  );
  return match?.value;
}

/** The yes or no option of a choice list, in English, Italian, French or German. */
function yesNoOption(field: FormField, yes: boolean): string | undefined {
  const words = yes ? YES : NO;
  return field.options.find((option) => words.includes(normalizeLabel(option.text)))?.value;
}

function firstAndLast(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { first: parts[0] ?? "", last: "" };
  // "Maria De Luca" or "Anna Maria Rossi" cannot be split reliably: leave both for the user.
  if (parts.length > 2) return { first: "", last: "" };
  return { first: parts[0] ?? "", last: parts[parts.length - 1] ?? "" };
}

/** The first profile link whose label or address names the service, or undefined. */
function linkFor(profile: Profile, pattern: RegExp): string | undefined {
  const link = profile.links.find(
    (item) => pattern.test(normalizeLabel(item.label)) || pattern.test(item.url.toLowerCase()),
  );
  return link?.url;
}

/** The text a profile key gives, or null when the profile has none. `question` names the stored answer to use. */
function textFor(
  key: Exclude<FieldKey, "resume" | "coverLetter">,
  field: FormField,
  profile: Profile,
  question?: string,
): string | null {
  const contact = profile.contact;
  const nonEmpty = (value: string) => (value.trim() === "" ? null : value.trim());
  switch (key) {
    case "fullName":
      return nonEmpty(contact.fullName);
    case "firstName":
      return nonEmpty(firstAndLast(contact.fullName).first);
    case "lastName":
      return nonEmpty(firstAndLast(contact.fullName).last);
    case "email":
      return nonEmpty(contact.email);
    case "phone":
      return nonEmpty(contact.phone);
    case "location":
      return nonEmpty(contact.location);
    case "linkedin":
      return linkFor(profile, /linkedin\.com|linkedin/) ?? null;
    case "github":
      return linkFor(profile, /github\.com|github/) ?? null;
    case "website":
      return (
        profile.links.find(
          (item) =>
            /portfolio|website|personal|sito|blog/.test(normalizeLabel(item.label)) &&
            !/linkedin|github/.test(normalizeLabel(item.label)),
        )?.url ?? null
      );
    case "pronouns":
      return nonEmpty(profile.applicationDefaults.pronouns);
    case "noticePeriod":
      return nonEmpty(profile.applicationDefaults.noticePeriod);
    case "salary": {
      const amount = profile.applicationDefaults.salary.amount;
      return amount === null ? null : String(amount);
    }
    case "relocation": {
      const willing = profile.applicationDefaults.willingToRelocate;
      if (willing === null) return null;
      if (field.kind === "select") return yesNoOption(field, willing) ?? "";
      return null;
    }
    case "standardAnswer": {
      const label = normalizeLabel(question ?? (field.label || field.name));
      const answer = profile.standardAnswers.find(
        (item) => normalizeLabel(item.question) === label,
      );
      return answer ? answer.answer : null;
    }
  }
}

const TEXT_KINDS = new Set<FormField["kind"]>(["text", "textarea", "select"]);

/** What a profile key does with one control: the action to take, or why it is left for the user. */
export type KeyOutcome = { action: FillAction } | { reason: UnfilledReason };

/**
 * The fill for one control, given the profile key that names its value. `question` picks the stored
 * answer for the `standardAnswer` key; omitted, the control's own label is matched. Shared by the
 * rules (`planAutofill`) and the AI fallback, so both apply the same checks.
 */
export function actionForKey(
  field: FormField,
  key: FieldKey,
  sources: AutofillSources,
  question?: string,
): KeyOutcome {
  if (key === "resume" || key === "coverLetter") {
    if (field.kind !== "file") return { reason: "unsupported" };
    const document: DocumentKind = key === "resume" ? "cv" : "cover-letter";
    if (!sources.documents[document]) return { reason: "not-exported" };
    return { action: { id: field.id, kind: "file", document } };
  }

  if (field.kind === "file" || !TEXT_KINDS.has(field.kind)) return { reason: "unsupported" };

  const value = textFor(key, field, sources.profile, question);
  if (value === null || value === "") {
    return { reason: value === "" ? "no-option" : "no-value" };
  }

  if (field.kind === "select") {
    const option = key === "relocation" ? value : optionFor(field, value);
    if (option === undefined || option === "") return { reason: "no-option" };
    return { action: { id: field.id, kind: "select", value: option } };
  }
  return { action: { id: field.id, kind: "text", value } };
}

/**
 * Decides what autofill fills and what it leaves for the user. Honeypots and controls that already
 * hold a value are skipped. A control is filled only when a rule names its profile value and the
 * value is present; everything else is returned as unfilled, so the page can highlight it.
 */
export function planAutofill(
  fields: readonly FormField[],
  sources: AutofillSources,
  provider: FormProvider,
): FillPlan {
  const standardQuestions = sources.profile.standardAnswers.map((item) => item.question);
  const actions: FillAction[] = [];
  const unfilled: UnfilledField[] = [];

  for (const field of fields) {
    if (field.honeypot || field.hasValue) continue;
    const label = field.label || field.name || field.id;

    if (field.kind === "checkbox" || field.kind === "other") {
      unfilled.push({ id: field.id, label, reason: "unsupported" });
      continue;
    }
    const key = fieldKeyOf(field, provider, standardQuestions);
    if (key === null) {
      unfilled.push({ id: field.id, label, reason: "unmapped" });
      continue;
    }

    const outcome = actionForKey(field, key, sources);
    if ("reason" in outcome) {
      unfilled.push({ id: field.id, label, reason: outcome.reason });
    } else {
      actions.push(outcome.action);
    }
  }

  return { actions, unfilled };
}
