import {
  createAiModel,
  generateStructured,
  toAiError,
  type AiErrorCode,
  type AiModelHandle,
  type AiProviderConfig,
  type AiWarning,
} from "../ai";
import type { Profile } from "../profile/schema";
import type { ExplanationLanguage } from "../ranking/prompt";
import { documentSystemPrompt, documentUserPrompt, type DocumentJob } from "./prompt";
import {
  CoverLetterSchema,
  TailoredCvSchema,
  repairDocument,
  validateDocument,
  type DocumentContent,
  type DocumentIssue,
  type DocumentKind,
} from "./schema";

/** Tries of one document: the first answer, then one retry that names the rules it broke. */
export const DOCUMENT_ATTEMPTS = 2;

export interface GenerateDocumentInput {
  kind: DocumentKind;
  profile: Profile;
  job: DocumentJob;
  /** The language of the text: the user's UI language. */
  language: ExplanationLanguage;
  config: AiProviderConfig;
  /** Configured context size of the model, in tokens. */
  contextSize: number;
}

export interface GenerateDocumentOptions {
  abortSignal?: AbortSignal;
  /** Replaces the global fetch; tests pass a scripted double here. */
  fetch?: typeof fetch;
}

export type GenerateDocumentOutcome =
  { ok: true; content: DocumentContent; warnings: AiWarning[] } | { ok: false; code: AiErrorCode };

/** A tailored CV is about as long as the profile's JSON; hosted providers stop at this limit. */
const DOCUMENT_MAX_OUTPUT_TOKENS = 8192;

/** A repair that dropped everything it was given has nothing to show. */
function isEmpty(content: DocumentContent): boolean {
  return content.kind === "cover-letter"
    ? content.letter.paragraphs.length === 0
    : content.cv.experience.length === 0 && content.cv.skills.length === 0;
}

/**
 * Generates a tailored CV or a cover letter with one structured AI call per attempt. An answer that
 * breaks a rule of the validator (see `schema.ts`) is first set right from the profile
 * (`repairDocument`); when nothing usable is left it is sent back once with the rules it broke, and
 * an answer still broken after that is `invalid-output`, so no invented fact is ever returned. Provider
 * failures come back as their AI codes. Nothing is logged here.
 */
export async function generateDocument(
  input: GenerateDocumentInput,
  options: GenerateDocumentOptions = {},
): Promise<GenerateDocumentOutcome> {
  let model: AiModelHandle;
  try {
    model = createAiModel(
      { ...input.config, contextSize: input.contextSize },
      { fetch: options.fetch },
    );
  } catch (error) {
    return { ok: false, code: toAiError(error).code };
  }
  const system = documentSystemPrompt(input.kind, input.language);
  let issues: DocumentIssue[] = [];

  for (let attempt = 0; attempt < DOCUMENT_ATTEMPTS; attempt += 1) {
    const prompt = documentUserPrompt(input.profile, input.job, issues);
    try {
      const common = {
        model: model.model,
        capabilities: model.capabilities,
        system,
        prompt,
        contextSize: input.contextSize,
        maxOutputTokens: DOCUMENT_MAX_OUTPUT_TOKENS,
        abortSignal: options.abortSignal,
      };
      let content: DocumentContent;
      let attemptWarnings: AiWarning[];
      if (input.kind === "cv") {
        const result = await generateStructured({ ...common, schema: TailoredCvSchema });
        content = { kind: "cv", cv: result.value };
        attemptWarnings = result.warnings;
      } else {
        const result = await generateStructured({ ...common, schema: CoverLetterSchema });
        content = { kind: "cover-letter", letter: result.value };
        attemptWarnings = result.warnings;
      }
      issues = validateDocument(content, input.profile);
      if (issues.length === 0) {
        return { ok: true, content, warnings: attemptWarnings };
      }
      // Small drifts are set right from the profile; a document left with nothing is asked again.
      const repaired = repairDocument(content, input.profile);
      if (!isEmpty(repaired) && validateDocument(repaired, input.profile).length === 0) {
        return { ok: true, content: repaired, warnings: attemptWarnings };
      }
    } catch (error) {
      return { ok: false, code: toAiError(error).code };
    }
  }
  return { ok: false, code: "invalid-output" };
}
