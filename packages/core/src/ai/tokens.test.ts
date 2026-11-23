// protects=checkContextFit flags a prompt whose estimate plus the output reserve exceeds the context size, and not one that fits;
// fails_when=a prompt that fits the context is flagged, or one that overflows it is not;
// no_claim=the estimate is a character heuristic, so the result near the boundary is not proven against a real tokenizer.
import { describe, expect, it } from "vitest";
import { checkContextFit, estimateTokens } from "./tokens";

describe("context fit", () => {
  it("estimates about four characters per token", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("flags a prompt that leaves no room for the output reserve", () => {
    const fit = checkContextFit("x".repeat(4000), 1024);
    expect(fit.exceeds).toBe(true);
    expect(fit.estimatedTokens).toBe(1000 + 1024);
  });

  it("accepts a prompt that fits with the reserve", () => {
    expect(checkContextFit("short", 8192).exceeds).toBe(false);
  });
});
