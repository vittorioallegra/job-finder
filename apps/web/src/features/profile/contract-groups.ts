import type { JobPreferences } from "@job-finder/bridge";

type EmploymentType = JobPreferences["employmentTypes"][number];

/**
 * The contract choices "what you are looking for" offers, each standing for the job model's types:
 * an employee (full or part time, permanent or fixed term), freelance (self-employed or a
 * contractor on a project), or an internship.
 */
export const CONTRACT_GROUPS = {
  employee: ["full_time", "part_time", "temporary"],
  freelance: ["freelance", "contract"],
  internship: ["internship"],
} as const satisfies Record<string, readonly EmploymentType[]>;

export type ContractGroup = keyof typeof CONTRACT_GROUPS;
export const CONTRACT_GROUP_IDS = Object.keys(CONTRACT_GROUPS) as ContractGroup[];

/** The groups the stored types tick: a group is ticked when any of its types is stored. */
export function contractGroupsOf(types: readonly EmploymentType[]): ContractGroup[] {
  return CONTRACT_GROUP_IDS.filter((group) =>
    CONTRACT_GROUPS[group].some((type) => types.includes(type)),
  );
}

/** The types to store for the ticked groups. */
export function employmentTypesOf(groups: readonly ContractGroup[]): EmploymentType[] {
  return groups.flatMap((group) => [...CONTRACT_GROUPS[group]]);
}
