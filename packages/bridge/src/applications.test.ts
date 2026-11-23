// protects=the application request schemas accept a status, a note or both in an update, only the two-step confirmation counts (0 to 2) when starting, and reject unknown statuses, empty notes and unknown keys before main uses them;
// fails_when=an update with neither a status nor a note is accepted, a confirmation count of 3 or -1 is accepted, a status outside the machine's list is accepted, or a note with only spaces is stored;
// no_claim=whether the transition is allowed from the current status is checked in the desktop repository, not here;
import { describe, expect, it } from "vitest";
import { ApplicationStartRequestSchema, ApplicationUpdateRequestSchema } from "./applications";

describe("application request schemas", () => {
  it("requires a status or a note for an update, and accepts either one", () => {
    expect(ApplicationUpdateRequestSchema.safeParse({ applicationId: "a1" }).success).toBe(false);
    expect(
      ApplicationUpdateRequestSchema.safeParse({ applicationId: "a1", status: "applied" }).success,
    ).toBe(true);
    expect(
      ApplicationUpdateRequestSchema.safeParse({ applicationId: "a1", note: "Called HR" }).success,
    ).toBe(true);
    expect(
      ApplicationUpdateRequestSchema.safeParse({ applicationId: "a1", note: "   " }).success,
    ).toBe(false);
    expect(
      ApplicationUpdateRequestSchema.safeParse({ applicationId: "a1", status: "flying" }).success,
    ).toBe(false);
  });

  it("accepts only the confirmation counts 0 to 2 when starting, and defaults to none", () => {
    expect(ApplicationStartRequestSchema.parse({ jobId: "j1" }).confirmations).toBe(0);
    expect(ApplicationStartRequestSchema.safeParse({ jobId: "j1", confirmations: 2 }).success).toBe(
      true,
    );
    expect(ApplicationStartRequestSchema.safeParse({ jobId: "j1", confirmations: 3 }).success).toBe(
      false,
    );
    expect(
      ApplicationStartRequestSchema.safeParse({ jobId: "j1", confirmations: -1 }).success,
    ).toBe(false);
    expect(ApplicationStartRequestSchema.safeParse({ jobId: "j1", extra: true }).success).toBe(
      false,
    );
  });
});
