import type { AtsId } from "../types";
import type { FieldKey, FormField } from "./types";

/** The form a page belongs to: an ATS we know, or any other page. */
export type FormProvider = AtsId | "generic";

/** Lowercase letters and digits, accents removed, everything else a space. */
export function normalizeLabel(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Field names of the three ATS forms autofill knows. The names are matched exactly (after
 * lowercasing), so a custom question that reuses a name in another form is not mapped by it.
 */
const PROVIDER_NAME_RULES: Partial<Record<FormProvider, Array<[RegExp, FieldKey]>>> = {
  greenhouse: [
    [/\[first_name\]$/, "firstName"],
    [/\[last_name\]$/, "lastName"],
    [/\[email\]$/, "email"],
    [/\[phone\]$/, "phone"],
    [/\[location\]$/, "location"],
    [/\[resume\]$/, "resume"],
    [/\[cover_letter\]$/, "coverLetter"],
  ],
  lever: [
    [/^name$/, "fullName"],
    [/^email$/, "email"],
    [/^phone$/, "phone"],
    [/^urls\[linkedin\]$/, "linkedin"],
    [/^urls\[github\]$/, "github"],
    [/^urls\[(portfolio|other)\]$/, "website"],
    [/^resume$/, "resume"],
  ],
  ashby: [
    [/^_systemfield_name$/, "fullName"],
    [/^_systemfield_email$/, "email"],
    [/^_systemfield_phone$/, "phone"],
    [/^_systemfield_resume$/, "resume"],
    [/^_systemfield_linkedin_url$/, "linkedin"],
    [/^_systemfield_location$/, "location"],
  ],
};

/** The browser's autocomplete tokens that name a profile value. */
const AUTOCOMPLETE_RULES: Record<string, FieldKey> = {
  "given-name": "firstName",
  "family-name": "lastName",
  name: "fullName",
  email: "email",
  tel: "phone",
  "address-level2": "location",
};

/** Label keywords on the normalized label, in English and Italian. Anchored: only whole labels map. */
const LABEL_RULES: Array<[RegExp, FieldKey]> = [
  [/^(first|given) name$|^nome$/, "firstName"],
  [/^(last|family|sur) name$|^cognome$/, "lastName"],
  [/^(full|legal|your) name$|^name$|^nome e cognome$|^nome completo$/, "fullName"],
  [/^e? ?mail( address)?$|^e mail address$/, "email"],
  [
    /^(phone|phone number|telephone|telephone number|mobile|mobile number|telefono|cellulare)$/,
    "phone",
  ],
  [/^linkedin( profile| url| link)?$/, "linkedin"],
  [/^github( profile| url| link)?$/, "github"],
  [
    /^(portfolio|portfolio url|website|website url|personal website|personal site|sito web)$/,
    "website",
  ],
  [/^pronouns?$|^pronomi$/, "pronouns"],
  [/^notice period( in days| in weeks)?$|^preavviso$/, "noticePeriod"],
  [/^(salary|desired salary|expected salary|salary expectations?)$|^ral$/, "salary"],
  [/^(are you )?(willing|open) to relocate$|^relocation( assistance)?$/, "relocation"],
  [
    /^(current )?(location|city)$|^(sede|citta|residenza)$|^where are you (located|based)$/,
    "location",
  ],
];

const DOCUMENT_RULES: Array<[RegExp, "resume" | "coverLetter"]> = [
  [/cover letter|lettera di presentazione/, "coverLetter"],
  [/\b(resume|cv|curriculum vitae)\b/, "resume"],
];

/** The label a field is shown with, normalized; the name is the fallback for unlabeled controls. */
function labelOf(field: FormField): string {
  return normalizeLabel(field.label || field.name);
}

/**
 * The profile value a field asks for, by the first rule that matches: the ATS's own field name,
 * then the browser's autocomplete token, then the user's standard answer to that exact question,
 * then the label keywords. Returns null when no rule matches.
 */
export function fieldKeyOf(
  field: FormField,
  provider: FormProvider,
  standardQuestions: readonly string[],
): FieldKey | null {
  if (field.kind === "file") {
    const haystack = `${normalizeLabel(field.label)} ${normalizeLabel(field.name)}`;
    const rule = DOCUMENT_RULES.find(([pattern]) => pattern.test(haystack));
    return rule ? rule[1] : null;
  }

  const name = field.name.toLowerCase();
  for (const [pattern, key] of PROVIDER_NAME_RULES[provider] ?? []) {
    if (pattern.test(name)) return key;
  }

  const autocomplete = AUTOCOMPLETE_RULES[field.autocomplete.trim().toLowerCase()];
  if (autocomplete) return autocomplete;

  const label = labelOf(field);
  if (label !== "" && standardQuestions.some((question) => normalizeLabel(question) === label)) {
    return "standardAnswer";
  }
  for (const [pattern, key] of LABEL_RULES) {
    if (pattern.test(label)) return key;
  }
  return null;
}
