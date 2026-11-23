import { generateText } from "ai";
import { createAiModel, type AiProviderConfig, type AiProviderOptions } from "./provider";
import { toAiError, type AiErrorCode } from "./errors";

export type AiConnectionResult = { ok: true; model: string } | { ok: false; code: AiErrorCode };

export interface TestConnectionOptions extends AiProviderOptions {
  abortSignal?: AbortSignal;
}

/**
 * Sends one tiny request to the configured provider. The result carries only a code on failure,
 * so the caller can show "AI unavailable" with a reason and never echoes provider error bodies.
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
      abortSignal: options.abortSignal,
    });
    return { ok: true, model: config.model.trim() };
  } catch (error) {
    return { ok: false, code: toAiError(error).code };
  }
}
