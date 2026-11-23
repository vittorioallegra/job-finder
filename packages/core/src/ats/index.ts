import { ATS_IDS, type AtsAdapter, type AtsId } from "./types";
import { ashby } from "./ashby";
import { greenhouse } from "./greenhouse";
import { lever } from "./lever";
import { personio } from "./personio";
import { recruitee } from "./recruitee";
import { smartrecruiters } from "./smartrecruiters";
import { teamtailor } from "./teamtailor";
import { workable } from "./workable";

export * from "./types";
export * from "./detect";
export { isValidSlug, MAX_PAGES } from "./adapter";

export const ATS_ADAPTERS: Record<AtsId, AtsAdapter> = {
  greenhouse,
  lever,
  ashby,
  workable,
  smartrecruiters,
  personio,
  recruitee,
  teamtailor,
};

export function getAdapter(ats: AtsId): AtsAdapter {
  return ATS_ADAPTERS[ats];
}

export { ATS_IDS };
