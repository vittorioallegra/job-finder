// protects=planAutofill fills only the controls a rule maps to a profile value that is present, never overwrites a value, skips honeypots, uploads a document only when its PDF exists, and leaves every other control for the user with a reason;
// fails_when=a control with a value is overwritten, a honeypot is filled or highlighted, a CV is uploaded without its PDF, an unmapped or empty field is filled with a guess, a select gets an option that does not match, a checkbox is ticked, or a name is split into the wrong first and last name;
// no_claim=the rules are matched against descriptions of the forms, not the live pages; the DOM and the browser are tested in the desktop app, and the AI fallback for other forms is not part of this planner;
import { describe, expect, it } from "vitest";
import { emptyProfile, type Profile } from "../../profile/schema";
import { normalizeLabel } from "./rules";
import { planAutofill, type AutofillSources } from "./plan";
import type { FormField } from "./types";

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    ...emptyProfile(),
    contact: {
      fullName: "Maria Rossi",
      email: "maria@example.com",
      phone: "+39 333 1234567",
      location: "Milano",
    },
    links: [
      { label: "LinkedIn", url: "https://www.linkedin.com/in/maria" },
      { label: "GitHub", url: "https://github.com/maria" },
      { label: "Portfolio", url: "https://maria.example.com" },
    ],
    applicationDefaults: {
      workAuthorization: [],
      noticePeriod: "30 days",
      salary: { amount: 60000, currency: "EUR", period: "year" },
      willingToRelocate: true,
      pronouns: "she/her",
    },
    standardAnswers: [{ question: "Why do you want to work here?", answer: "I like the product." }],
    ...overrides,
  };
}

function field(overrides: Partial<FormField> & { id: string }): FormField {
  return {
    kind: "text",
    inputType: "text",
    name: "",
    label: "",
    autocomplete: "",
    required: false,
    hasValue: false,
    honeypot: false,
    options: [],
    accept: "",
    ...overrides,
  };
}

const ALL_DOCUMENTS: AutofillSources["documents"] = { cv: true, "cover-letter": true };

describe("planAutofill", () => {
  it("fills a Greenhouse form by its own field names, and uploads the CV and cover letter", () => {
    const fields = [
      field({ id: "1", name: "job_application[first_name]", label: "First Name *" }),
      field({ id: "2", name: "job_application[last_name]", label: "Last Name *" }),
      field({ id: "3", name: "job_application[email]", label: "Email *", inputType: "email" }),
      field({ id: "4", name: "job_application[phone]", label: "Phone", inputType: "tel" }),
      field({ id: "5", name: "job_application[resume]", kind: "file", label: "Resume/CV *" }),
      field({
        id: "6",
        name: "job_application[cover_letter]",
        kind: "file",
        label: "Cover Letter",
      }),
    ];

    const plan = planAutofill(
      fields,
      { profile: profile(), documents: ALL_DOCUMENTS },
      "greenhouse",
    );

    expect(plan.actions).toEqual([
      { id: "1", kind: "text", value: "Maria" },
      { id: "2", kind: "text", value: "Rossi" },
      { id: "3", kind: "text", value: "maria@example.com" },
      { id: "4", kind: "text", value: "+39 333 1234567" },
      { id: "5", kind: "file", document: "cv" },
      { id: "6", kind: "file", document: "cover-letter" },
    ]);
    expect(plan.unfilled).toEqual([]);
  });

  it("leaves first and last name to the user when the full name has more than two parts", () => {
    // protects=a multi-part name is never split into a wrong first or last name; fails_when=Maria De Luca is typed with the last name Luca; no_claim=names with two parts, covered above;
    const fields = [
      field({ id: "1", name: "job_application[first_name]", label: "First Name *" }),
      field({ id: "2", name: "job_application[last_name]", label: "Last Name *" }),
    ];
    const multi = profile({
      contact: { ...profile().contact, fullName: "Maria De Luca" },
    });

    const plan = planAutofill(fields, { profile: multi, documents: ALL_DOCUMENTS }, "greenhouse");

    expect(plan.actions).toEqual([]);
    expect(plan.unfilled.map((item) => item.reason)).toEqual(["no-value", "no-value"]);
  });

  it("fills a Lever form by its field names, including its link fields", () => {
    const fields = [
      field({ id: "1", name: "name", label: "Full name" }),
      field({ id: "2", name: "email", label: "Email", inputType: "email" }),
      field({ id: "3", name: "phone", label: "Phone" }),
      field({ id: "4", name: "urls[LinkedIn]", label: "LinkedIn URL" }),
      field({ id: "5", name: "urls[GitHub]", label: "GitHub URL" }),
      field({ id: "6", name: "urls[Portfolio]", label: "Portfolio" }),
      field({ id: "7", name: "resume", kind: "file", label: "Resume" }),
    ];

    const plan = planAutofill(fields, { profile: profile(), documents: ALL_DOCUMENTS }, "lever");

    expect(plan.actions).toEqual([
      { id: "1", kind: "text", value: "Maria Rossi" },
      { id: "2", kind: "text", value: "maria@example.com" },
      { id: "3", kind: "text", value: "+39 333 1234567" },
      { id: "4", kind: "text", value: "https://www.linkedin.com/in/maria" },
      { id: "5", kind: "text", value: "https://github.com/maria" },
      { id: "6", kind: "text", value: "https://maria.example.com" },
      { id: "7", kind: "file", document: "cv" },
    ]);
  });

  it("fills an Ashby form by its system fields", () => {
    const fields = [
      field({ id: "1", name: "_systemfield_name", label: "Name" }),
      field({ id: "2", name: "_systemfield_email", label: "Email" }),
      field({ id: "3", name: "_systemfield_resume", kind: "file", label: "Resume" }),
      field({ id: "4", name: "_systemfield_linkedin_url", label: "LinkedIn" }),
    ];

    const plan = planAutofill(fields, { profile: profile(), documents: ALL_DOCUMENTS }, "ashby");

    expect(plan.actions.map((action) => action.id)).toEqual(["1", "2", "3", "4"]);
    expect(plan.unfilled).toEqual([]);
  });

  it("uses a stored answer for a question, and the profile's choice for relocation", () => {
    const fields = [
      field({ id: "1", label: "Why do you want to work here?", kind: "textarea" }),
      field({
        id: "2",
        label: "Are you willing to relocate?",
        kind: "select",
        options: [
          { value: "a", text: "Select" },
          { value: "b", text: "Yes" },
          { value: "c", text: "No" },
        ],
      }),
    ];

    const plan = planAutofill(fields, { profile: profile(), documents: ALL_DOCUMENTS }, "generic");

    expect(plan.actions).toEqual([
      { id: "1", kind: "text", value: "I like the product." },
      { id: "2", kind: "select", value: "b" },
    ]);
  });

  it("never overwrites a value, skips honeypots, and leaves checkboxes and unknown questions with the user", () => {
    const fields = [
      field({ id: "1", name: "job_application[first_name]", label: "First Name", hasValue: true }),
      field({ id: "2", name: "website", label: "Website", honeypot: true }),
      field({ id: "3", kind: "checkbox", inputType: "checkbox", label: "I agree to the terms" }),
      field({ id: "4", label: "Describe a time you led a project" }),
    ];

    const plan = planAutofill(
      fields,
      { profile: profile(), documents: ALL_DOCUMENTS },
      "greenhouse",
    );

    expect(plan.actions).toEqual([]);
    expect(plan.unfilled).toEqual([
      { id: "3", label: "I agree to the terms", reason: "unsupported" },
      { id: "4", label: "Describe a time you led a project", reason: "unmapped" },
    ]);
  });

  it("does not upload a CV whose PDF is not exported, and reports it", () => {
    const fields = [field({ id: "1", kind: "file", label: "Resume/CV" })];

    const plan = planAutofill(
      fields,
      { profile: profile(), documents: { cv: false, "cover-letter": true } },
      "generic",
    );

    expect(plan.actions).toEqual([]);
    expect(plan.unfilled).toEqual([{ id: "1", label: "Resume/CV", reason: "not-exported" }]);
  });

  it("leaves a field the profile has empty, and a select with no matching option", () => {
    const empty = profile({
      contact: { fullName: "Maria Rossi", email: "", phone: "", location: "" },
      applicationDefaults: { ...profile().applicationDefaults, noticePeriod: "" },
    });
    const fields = [
      field({ id: "1", label: "Email", inputType: "email" }),
      field({ id: "2", label: "Notice period" }),
      field({
        id: "3",
        label: "Pronouns",
        kind: "select",
        options: [{ value: "x", text: "he/him" }],
      }),
    ];

    const plan = planAutofill(fields, { profile: empty, documents: ALL_DOCUMENTS }, "generic");

    expect(plan.actions).toEqual([]);
    expect(plan.unfilled).toEqual([
      { id: "1", label: "Email", reason: "no-value" },
      { id: "2", label: "Notice period", reason: "no-value" },
      { id: "3", label: "Pronouns", reason: "no-option" },
    ]);
  });

  it("matches labels with accents and Italian names", () => {
    expect(normalizeLabel("Città")).toBe("citta");
    const fields = [
      field({ id: "1", label: "Nome e cognome" }),
      field({ id: "2", label: "Città" }),
    ];

    const plan = planAutofill(fields, { profile: profile(), documents: ALL_DOCUMENTS }, "generic");

    expect(plan.actions).toEqual([
      { id: "1", kind: "text", value: "Maria Rossi" },
      { id: "2", kind: "text", value: "Milano" },
    ]);
  });
});
