import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from "ai";
import type { z } from "zod";
import type { AiCapabilities } from "./capabilities";
import { AiError, toAiError } from "./errors";
import { checkContextFit, DEFAULT_OUTPUT_RESERVE_TOKENS } from "./tokens";

export interface AiWarning {
  code: "context-exceeded";
  estimatedTokens: number;
  contextSize: number;
}

export interface StructuredOptions<T> {
  model: LanguageModel;
  capabilities: AiCapabilities;
  schema: z.ZodType<T>;
  system?: string;
  prompt: string;
  /** Configured context size of the model, in tokens. */
  contextSize: number;
  abortSignal?: AbortSignal;
  /** Repair attempts after an invalid answer. Defaults to one. */
  repairRetries?: number;
  /** Upper bound on the answer, in tokens. Defaults to the output reserve used by the context check. */
  maxOutputTokens?: number;
}

export interface StructuredResult<T> {
  value: T;
  warnings: AiWarning[];
}

const MAX_ISSUE_LENGTH = 500;
const MAX_REPAIR_OUTPUT_LENGTH = 4000;

/** Pulls the JSON object or array out of a text answer, tolerating a Markdown code fence around it. */
function extractJsonText(text: string): string | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.search(/[[{]/);
  const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
  if (start < 0 || end < start) {
    return undefined;
  }
  return candidate.slice(start, end + 1);
}

type Attempt<T> = { ok: true; value: T } | { ok: false; issue: string; raw: string };

function repairPrompt(original: string, issue: string, raw: string): string {
  return [
    original,
    "",
    `Your previous answer was rejected: ${issue.slice(0, MAX_ISSUE_LENGTH)}`,
    "Previous answer:",
    raw.slice(0, MAX_REPAIR_OUTPUT_LENGTH),
    "",
    "Reply again with only a JSON value that matches the requested schema.",
  ].join("\n");
}

/**
 * Asks the model for a value matching `schema`. Native structured output is used when the
 * provider has it; otherwise the answer is parsed from text. An invalid answer gets one repair
 * retry that shows the model its own output and the validation issue. Provider failures are
 * thrown as `AiError`, never retried here (the SDK already retries transient HTTP errors).
 */
export async function generateStructured<T>(
  options: StructuredOptions<T>,
): Promise<StructuredResult<T>> {
  const warnings: AiWarning[] = [];
  const fit = checkContextFit(`${options.system ?? ""}\n${options.prompt}`, options.contextSize);
  if (fit.exceeds) {
    warnings.push({
      code: "context-exceeded",
      estimatedTokens: fit.estimatedTokens,
      contextSize: options.contextSize,
    });
  }

  const retries = options.repairRetries ?? 1;
  let prompt = options.prompt;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const result = await runAttempt(options, prompt);
    if (result.ok) {
      return { value: result.value, warnings };
    }
    prompt = repairPrompt(options.prompt, result.issue, result.raw);
  }
  throw new AiError("invalid-output", "The model did not return output that matches the schema");
}

async function runAttempt<T>(options: StructuredOptions<T>, prompt: string): Promise<Attempt<T>> {
  const { model, schema, system, abortSignal } = options;
  const maxOutputTokens = options.maxOutputTokens ?? DEFAULT_OUTPUT_RESERVE_TOKENS;
  if (options.capabilities.nativeStructuredOutput) {
    try {
      const result = await generateText({
        model,
        system,
        prompt,
        output: Output.object({ schema }),
        maxOutputTokens,
        abortSignal,
      });
      return { ok: true, value: result.output as T };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        return { ok: false, issue: error.message, raw: error.text ?? "" };
      }
      throw toAiError(error);
    }
  }

  let text: string;
  try {
    text = (await generateText({ model, system, prompt, maxOutputTokens, abortSignal })).text;
  } catch (error) {
    throw toAiError(error);
  }
  const json = extractJsonText(text);
  if (json === undefined) {
    return { ok: false, issue: "the answer contained no JSON", raw: text };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, issue: "the answer was not valid JSON", raw: text };
  }
  const checked = schema.safeParse(parsed);
  if (!checked.success) {
    return { ok: false, issue: checked.error.message, raw: text };
  }
  return { ok: true, value: checked.data };
}
