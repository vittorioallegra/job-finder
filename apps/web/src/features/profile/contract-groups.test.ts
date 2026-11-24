// protects=the three contract choices stand for the job model's types, and stored types tick the choice they belong to;
// fails_when=a choice stores the wrong types, a contractor counts as an employee, or a profile that stored one type of a group shows the group unticked;
// no_claim=how jobs state their contract is the normalizer's concern, tested in core.
import { describe, expect, it } from "vitest";
import { contractGroupsOf, employmentTypesOf } from "./contract-groups";

describe("contract groups", () => {
  it("maps each choice to its types and back", () => {
    expect(employmentTypesOf(["freelance", "internship"])).toEqual([
      "freelance",
      "contract",
      "internship",
    ]);
    expect(contractGroupsOf(["contract"])).toEqual(["freelance"]);
    expect(contractGroupsOf(["full_time", "freelance"])).toEqual(["employee", "freelance"]);
    expect(contractGroupsOf([])).toEqual([]);
  });
});
