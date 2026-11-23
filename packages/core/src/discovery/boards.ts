import { detectAtsFromUrl } from "../ats/detect";
import type { AtsId } from "../ats/types";

const BOARD_URL: Record<AtsId, (slug: string) => string> = {
  greenhouse: (slug) => `https://boards.greenhouse.io/${slug}`,
  lever: (slug) => `https://jobs.lever.co/${slug}`,
  ashby: (slug) => `https://jobs.ashbyhq.com/${slug}`,
  workable: (slug) => `https://apply.workable.com/${slug}`,
  smartrecruiters: (slug) => `https://jobs.smartrecruiters.com/${slug}`,
  personio: (slug) => `https://${slug}.jobs.personio.de`,
  recruitee: (slug) => `https://${slug}.recruitee.com`,
  teamtailor: (slug) => `https://${slug}.teamtailor.com`,
};

/**
 * The canonical careers address of a board, or undefined when the pair does not round-trip through
 * `detectAtsFromUrl` (a slug the URL rules would not read back as the same board).
 */
export function canonicalBoardUrl(ats: AtsId, slug: string): string | undefined {
  const url = BOARD_URL[ats](slug);
  const detected = detectAtsFromUrl(url);
  return detected?.ats === ats && detected.slug === slug ? url : undefined;
}
