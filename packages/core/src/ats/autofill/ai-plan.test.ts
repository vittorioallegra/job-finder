// protects=planAiAnswers fills a field only from a profile key the planner checks, types a draft only into a text field when every number in it is in the profile, and leaves every other candidate empty with a reason;
// fails_when=a value the profile does not hold is typed, a draft with an invented number is typed, a draft goes into a select or a file control, a key answer skips the checks of a rule, a stored question the profile lacks is answered, a field with both or neither of key and draft is filled, an answer for a field that is not a candidate is applied, or a control that already holds a value is overwritten;
// no_claim=the answers are hand-written stand-ins for the model's output, not model output; whether a real model picks the right key or writes a good draft is not shown here;
import { describe, expect, it } from "vitest";
import { emptyProfile, type Profile } from "../../profile/schema";
import { draftIsGrounded, planAiAnswers, type AiFieldAnswer } from "./ai-plan";
import type { AutofillSources } from "./plan";
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
    experience: [
      {
        company: "Acme",
        title: "Engineer",
        location: "Milano",
        startDate: "2019",
        endDate: "2024",
        bullets: ["Cut latency by 40%"],
      },
    ],
    standardAnswers: [{ question: "Why do you want to work here?", answer: "I like the product." }],
    ...overrides,
  };
}

const sources: AutofillSources = {
  profile: profile(),
  documents: { cv: true, "cover-letter": true },
};

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

describe("planAiAnswers", () => {
  it("fills a key answer with the profile value, through the same checks as a rule", () => {
    const plan = planAiAnswers(
      [field({ id: "c0-1", label: "Current location" })],
      [{ id: "c0-1", key: "location", standardQuestion: null, draft: null }],
      sources,
    );

    expect(plan.actions).toEqual([{ id: "c0-1", kind: "text", value: "Milano" }]);
    expect(plan.unfilled).toEqual([]);
    expect(plan.drafted).toEqual([]);
  });

  it("types a grounded draft into a textarea and marks it as drafted", () => {
    const plan = planAiAnswers(
      [field({ id: "c0-2", kind: "textarea", label: "Anything else?" })],
      [{ id: "c0-2", key: null, standardQuestion: null, draft: "I cut latency by 40% at Acme." }],
      sources,
    );

    expect(plan.actions).toEqual([
      { id: "c0-2", kind: "text", value: "I cut latency by 40% at Acme." },
    ]);
    expect(plan.drafted).toEqual(["c0-2"]);
  });

  it("leaves a draft with a number the profile lacks empty, as ai-unverified", () => {
    const plan = planAiAnswers(
      [field({ id: "c0-3", kind: "textarea", label: "Years of Go?" })],
      [{ id: "c0-3", key: null, standardQuestion: null, draft: "I have 12 years of Go." }],
      sources,
    );

    expect(plan.actions).toEqual([]);
    expect(plan.drafted).toEqual([]);
    expect(plan.unfilled).toEqual([{ id: "c0-3", label: "Years of Go?", reason: "ai-unverified" }]);
  });

  it("refuses a draft for a select, and any answer with both or neither of key and draft", () => {
    const plan = planAiAnswers(
      [
        field({ id: "s", kind: "select", label: "Pick" }),
        field({ id: "both", label: "Both" }),
        field({ id: "neither", label: "Neither" }),
        field({ id: "none", label: "No answer" }),
      ],
      [
        { id: "s", key: null, standardQuestion: null, draft: "Some text" },
        { id: "both", key: "location", standardQuestion: null, draft: "Some text" },
        { id: "neither", key: null, standardQuestion: null, draft: null },
      ],
      sources,
    );

    expect(plan.actions).toEqual([]);
    expect(plan.unfilled).toEqual([
      { id: "s", label: "Pick", reason: "ai-no-answer" },
      { id: "both", label: "Both", reason: "ai-no-answer" },
      { id: "neither", label: "Neither", reason: "ai-no-answer" },
      { id: "none", label: "No answer", reason: "ai-no-answer" },
    ]);
  });

  it("answers a stored question only when the profile stores it, with the stored answer", () => {
    const plan = planAiAnswers(
      [
        field({ id: "known", kind: "textarea", label: "Why here?" }),
        field({ id: "unknown", kind: "textarea", label: "Your dream?" }),
      ],
      [
        {
          id: "known",
          key: "standardAnswer",
          standardQuestion: "why do you want to work here",
          draft: null,
        },
        {
          id: "unknown",
          key: "standardAnswer",
          standardQuestion: "What is your dream?",
          draft: null,
        },
      ],
      sources,
    );

    expect(plan.actions).toEqual([{ id: "known", kind: "text", value: "I like the product." }]);
    expect(plan.unfilled).toEqual([
      { id: "unknown", label: "Your dream?", reason: "ai-no-answer" },
    ]);
  });

  it("never fills a file control with a text key, or a file key into a text field", () => {
    const plan = planAiAnswers(
      [
        field({ id: "text-resume", label: "Resume" }),
        field({ id: "file-email", kind: "file", label: "Attach" }),
      ],
      [
        { id: "text-resume", key: "resume", standardQuestion: null, draft: null },
        { id: "file-email", key: "email", standardQuestion: null, draft: null },
      ],
      sources,
    );

    expect(plan.actions).toEqual([]);
    expect(plan.unfilled).toEqual([
      { id: "text-resume", label: "Resume", reason: "unsupported" },
      { id: "file-email", label: "Attach", reason: "unsupported" },
    ]);
  });

  it("ignores answers for fields that are not candidates, and never touches a control with a value", () => {
    const plan = planAiAnswers(
      [field({ id: "filled", label: "Email", hasValue: true })],
      [
        { id: "filled", key: "email", standardQuestion: null, draft: null },
        { id: "elsewhere", key: "email", standardQuestion: null, draft: null },
      ],
      sources,
    );

    expect(plan).toEqual({ actions: [], unfilled: [], drafted: [] });
  });

  it("uses the first answer given for an id", () => {
    const answers: AiFieldAnswer[] = [
      { id: "c0-9", key: "email", standardQuestion: null, draft: null },
      { id: "c0-9", key: "phone", standardQuestion: null, draft: null },
    ];
    const plan = planAiAnswers([field({ id: "c0-9", label: "Contact" })], answers, sources);

    expect(plan.actions).toEqual([{ id: "c0-9", kind: "text", value: "maria@example.com" }]);
  });
});

describe("draftIsGrounded", () => {
  it("accepts numbers the profile has as whole numbers and rejects others and long drafts", () => {
    const text = JSON.stringify(profile());

    expect(draftIsGrounded("Cut latency by 40%.", text)).toBe(true);
    expect(draftIsGrounded("Cut latency by 4%.", text)).toBe(false);
    expect(draftIsGrounded("Six years.", text)).toBe(true);
    expect(draftIsGrounded("Ten years.", text)).toBe(true);
    expect(draftIsGrounded("Over 2019 projects.", text)).toBe(true);
    expect(draftIsGrounded("x".repeat(2001), text)).toBe(false);
  });
});
