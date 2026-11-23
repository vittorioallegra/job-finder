import { z } from "zod";
import type { Profile } from "../../profile/schema";
import { actionForKey, type AutofillSources } from "./plan";
import { normalizeLabel } from "./rules";
import type { FieldKey, FillAction, FormField, UnfilledField, UnfilledReason } from "./types";

/**
 * The profile keys the AI may choose for a field. Each one resolves to a value the profile holds, so
 * the AI never supplies a value of its own for these.
 */
export const AI_FIELD_KEYS = [
  "fullName",
  "firstName",
  "lastName",
  "email",
  "phone",
  "location",
  "linkedin",
  "github",
  "website",
  "pronouns",
  "noticePeriod",
  "salary",
  "relocation",
  "resume",
  "coverLetter",
  "standardAnswer",
] as const satisfies readonly FieldKey[];

/** Most fields one AI call maps; the rest stay for the user. */
export const MAX_AI_FIELDS = 80;

/** Longest draft the AI may write, in characters. */
export const MAX_DRAFT_CHARS = 2000;

/**
 * One answer per form field id. Every answer names a key, a stored question (for the
 * `standardAnswer` key only), or a draft (free text, for text and textarea fields); all null means
 * the profile has no answer. Unknown ids are ignored by the planner.
 */
export const AutofillAnswersSchema = z.object({
  answers: z
    .array(
      z.object({
        id: z.string().max(64),
        key: z.enum(AI_FIELD_KEYS).nullish(),
        standardQuestion: z.string().max(500).nullish(),
        draft: z
          .string()
          .max(MAX_DRAFT_CHARS * 2)
          .nullish(),
      }),
    )
    .max(200),
});
export type AiFieldAnswer = z.infer<typeof AutofillAnswersSchema>["answers"][number];

/**
 * The part of the profile the AI sees: the experience, skills and summary it needs to write a draft.
 * Contact details, links and the stored answers' text are not sent; the planner fills those itself.
 */
export function profileForAi(profile: Profile) {
  return {
    headline: profile.headline,
    summary: profile.summary,
    experience: profile.experience,
    education: profile.education,
    skills: profile.skills,
    languages: profile.languages,
    certifications: profile.certifications,
  };
}

/** The result of checking the AI's answers against the form and the profile. */
export interface AiFillPlan {
  actions: FillAction[];
  /** Candidate fields the AI did not fill, with the reason the page shows. */
  unfilled: UnfilledField[];
  /** Ids of the fields filled with an AI draft, so the page and the panel can mark them. */
  drafted: string[];
}

const NUMBER = /\d+/g;

/**
 * A draft is typed only when every number in it appears in the profile (as a whole number) and it is
 * short enough. Anything else is an invented fact or noise, and is left for the user.
 */
export function draftIsGrounded(draft: string, profileText: string): boolean {
  if (draft.length > MAX_DRAFT_CHARS) return false;
  const numbers = draft.match(NUMBER) ?? [];
  return numbers.every((number) => new RegExp(`(?<!\\d)${number}(?!\\d)`).test(profileText));
}

/**
 * Turns the AI's answers into fills. `candidates` are the fields the rules could not map and that
 * are not honeypots or filled already. A key answer goes through the same checks as a rule
 * (`actionForKey`); a draft is typed only for a text field and only when it is grounded. A field
 * without an answer, with both or neither of key and draft, or with an unknown stored question
 * stays empty and is reported as `ai-no-answer`.
 */
export function planAiAnswers(
  candidates: readonly FormField[],
  answers: readonly AiFieldAnswer[],
  sources: AutofillSources,
): AiFillPlan {
  const byId = new Map<string, AiFieldAnswer>();
  for (const answer of answers) {
    if (!byId.has(answer.id)) byId.set(answer.id, answer);
  }
  const profileText = JSON.stringify(profileForAi(sources.profile));
  const actions: FillAction[] = [];
  const unfilled: UnfilledField[] = [];
  const drafted: string[] = [];

  for (const field of candidates) {
    if (field.honeypot || field.hasValue) continue;
    const label = field.label || field.name || field.id;
    const leave = (reason: UnfilledReason) => unfilled.push({ id: field.id, label, reason });

    const answer = byId.get(field.id);
    const key = answer?.key ?? null;
    const draft = answer?.draft?.trim() ?? "";
    if (answer === undefined || (key !== null) === (draft !== "")) {
      leave("ai-no-answer");
      continue;
    }

    if (key !== null) {
      let question: string | undefined;
      if (key === "standardAnswer") {
        const wanted = normalizeLabel(answer?.standardQuestion ?? "");
        const stored = sources.profile.standardAnswers.find(
          (item) => normalizeLabel(item.question) === wanted,
        );
        if (stored === undefined) {
          leave("ai-no-answer");
          continue;
        }
        question = stored.question;
      }
      const outcome = actionForKey(field, key, sources, question);
      if ("reason" in outcome) {
        leave(outcome.reason);
      } else {
        actions.push(outcome.action);
      }
      continue;
    }

    if (field.kind !== "text" && field.kind !== "textarea") {
      leave("ai-no-answer");
      continue;
    }
    if (!draftIsGrounded(draft, profileText)) {
      leave("ai-unverified");
      continue;
    }
    actions.push({ id: field.id, kind: "text", value: draft });
    drafted.push(field.id);
  }

  return { actions, unfilled, drafted };
}
