// protects=the status machine allows only the planned moves, the duplicate guard counts applications past preparing with a 90-day company window, and the hide-applied set covers submitted or ended applications, the statuses before submitting form one group and only they can be deleted;
// fails_when=a move skips a step (bookmarked to applied), a finished application moves again, a bookmark or preparing application counts as a duplicate, a company outside 90 days warns, or a same-job match needs fewer than two confirmations, a submitted application counts as deletable, or a draft cannot go straight to applied;
// no_claim=the database writes that apply a move, and the timestamps they store, are not covered here; the desktop repository tests cover them;
import { describe, expect, it } from "vitest";
import {
  APPLIED_STATUSES,
  canTransition,
  DUPLICATE_WINDOW_MS,
  GUARD_STATUSES,
  APPLICATION_GROUPS,
  groupOf,
  isUnsent,
  requiredConfirmations,
  withinDuplicateWindow,
  type ApplicationStatus,
} from "./index";

describe("application status machine", () => {
  it("allows the planned moves and no others", () => {
    expect(canTransition("bookmarked", "preparing")).toBe(true);
    expect(canTransition("preparing", "ready")).toBe(true);
    expect(canTransition("ready", "applied")).toBe(true);
    expect(canTransition("applied", "interviewing")).toBe(true);
    expect(canTransition("interviewing", "offer")).toBe(true);
    expect(canTransition("applied", "rejected")).toBe(true);
    expect(canTransition("bookmarked", "applied")).toBe(false);
    expect(canTransition("preparing", "applied")).toBe(true);
    expect(canTransition("offer", "withdrawn")).toBe(false);
    expect(canTransition("rejected", "applied")).toBe(false);
  });

  it("keeps the duplicate guard on applications past preparing, and the hide-applied filter on submitted or ended ones", () => {
    const all: ApplicationStatus[] = [
      "bookmarked",
      "preparing",
      "ready",
      "applied",
      "interviewing",
      "offer",
      "rejected",
      "withdrawn",
    ];
    expect(all.filter((status) => GUARD_STATUSES.includes(status))).toEqual([
      "ready",
      "applied",
      "interviewing",
      "offer",
      "rejected",
      "withdrawn",
    ]);
    expect(APPLIED_STATUSES).toEqual(["applied", "interviewing", "offer", "rejected", "withdrawn"]);
  });
});

describe("duplicate confirmations", () => {
  it("needs two confirmations for the same job, one for the same company, none otherwise", () => {
    expect(requiredConfirmations({ sameJob: 1, sameCompany: 0 })).toBe(2);
    expect(requiredConfirmations({ sameJob: 2, sameCompany: 3 })).toBe(2);
    expect(requiredConfirmations({ sameJob: 0, sameCompany: 1 })).toBe(1);
    expect(requiredConfirmations({ sameJob: 0, sameCompany: 0 })).toBe(0);
  });

  it("counts a company application as inside the window up to 90 days, and not after", () => {
    const now = 1_000_000_000_000;
    expect(DUPLICATE_WINDOW_MS).toBe(90 * 24 * 60 * 60 * 1000);
    expect(withinDuplicateWindow(now - DUPLICATE_WINDOW_MS, now)).toBe(true);
    expect(withinDuplicateWindow(now - DUPLICATE_WINDOW_MS - 1, now)).toBe(false);
  });

  it("shows the statuses before submitting as one group, and only those can be deleted", () => {
    expect(groupOf("bookmarked")).toBe("to-send");
    expect(groupOf("preparing")).toBe("to-send");
    expect(groupOf("ready")).toBe("to-send");
    expect(groupOf("interviewing")).toBe("interviewing");
    expect(APPLICATION_GROUPS).toEqual([
      "to-send",
      "applied",
      "interviewing",
      "offer",
      "rejected",
      "withdrawn",
    ]);
    expect(isUnsent("ready")).toBe(true);
    expect(isUnsent("applied")).toBe(false);
  });
});
