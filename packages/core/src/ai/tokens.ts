/** Rough token count: about four characters per token for English and Italian prose. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface ContextFit {
  estimatedTokens: number;
  contextSize: number;
  exceeds: boolean;
}

export const DEFAULT_OUTPUT_RESERVE_TOKENS = 1024;

/** Compares the prompt (plus room for the answer) with the configured context size. */
export function checkContextFit(
  inputText: string,
  contextSize: number,
  outputReserveTokens = DEFAULT_OUTPUT_RESERVE_TOKENS,
): ContextFit {
  const estimatedTokens = estimateTokens(inputText) + outputReserveTokens;
  return { estimatedTokens, contextSize, exceeds: estimatedTokens > contextSize };
}
