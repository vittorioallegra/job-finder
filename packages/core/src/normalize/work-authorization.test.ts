// protects=a remote job whose description ties it to a country (authorized to work there, U.S. citizenship, a security clearance) gets that country as its remote scope, and a description that names none leaves the job open;
// fails_when=the Oddball wording is missed, a U.S.-only requirement is read as open to everyone, a sentence without such a requirement gives a country, or a place that is not a country becomes a scope;
// no_claim=the filter that hides jobs for other places is not run here, only the reading of the text;
import { describe, expect, it } from "vitest";
import { remoteScopeFromDescription } from "./work-authorization";

describe("remote scope from a description", () => {
  it("reads the work authorization and clearance wording of a federal contractor as the United States", () => {
    const text =
      "Requirements:\n\nApplicants must be authorized to work in the United States. In alignment with federal contract requirements, certain roles may also require U.S. citizenship and the ability to obtain and maintain a federal background investigation and/or a security clearance.";
    expect(remoteScopeFromDescription(text)).toBe("United States");
  });

  it("reads authorization to work in other countries, and several of them", () => {
    expect(remoteScopeFromDescription("You must be eligible to work in Germany.")).toBe("Germany");
    expect(
      remoteScopeFromDescription("Candidates must be authorized to work in the U.S. or Canada."),
    ).toBe("United States / Canada");
    expect(remoteScopeFromDescription("US citizens only.")).toBe("United States");
    expect(remoteScopeFromDescription("A security clearance is required.")).toBe("United States");
  });

  it("leaves a job open when the text names no country", () => {
    expect(
      remoteScopeFromDescription("Work from anywhere, with a team across Europe."),
    ).toBeUndefined();
    expect(
      remoteScopeFromDescription("You must be authorized to work in the country where you live."),
    ).toBeUndefined();
    expect(
      remoteScopeFromDescription("Join us based on your skills, not on your résumé."),
    ).toBeUndefined();
    expect(remoteScopeFromDescription("")).toBeUndefined();
  });
});
