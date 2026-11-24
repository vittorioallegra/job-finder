import { generateText } from "ai";
import { createAiModel, type AiProviderConfig, type AiProviderOptions } from "./provider";
import { toAiError, type AiErrorCode } from "./errors";

export type AiConnectionResult =
  { ok: true; model: string } | { ok: false; code: AiErrorCode; detail?: string };

export interface TestConnectionOptions extends AiProviderOptions {
  abortSignal?: AbortSignal;
}

/**
 * Sends one tiny request to the configured provider. The result carries only a code on failure,
 * and at most a short
 * technical detail (HTTP status and the provider's error identifiers), never provider error text.
 */
export async function testAiConnection(
  config: AiProviderConfig,
  options: TestConnectionOptions = {},
): Promise<AiConnectionResult> {
  try {
    const { model } = createAiModel(config, options);
    await generateText({
      model,
      prompt: "Reply with the single word: ok",
      maxOutputTokens: 16,
      // One answer is enough to explain a failure; retries would only make the user wait.
      maxRetries: 0,
      abortSignal: options.abortSignal,
    });
    return { ok: true, model: config.model.trim() };
  } catch (error) {
    const { code, detail } = toAiError(error);
    return detail === null ? { ok: false, code } : { ok: false, code, detail };
  }
}
