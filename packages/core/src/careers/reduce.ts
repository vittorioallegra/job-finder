import { load } from "cheerio";
import { collapseWhitespace, htmlToText } from "../normalize";

/** Links kept from one page. A posting whose link is cut is still read; its identity then comes from its title and location. */
export const MAX_LINKS = 300;
const LINK_TEXT_MAX = 200;

export interface CareersLink {
  /** Visible text of the link (or its label), collapsed. May be empty. */
  text: string;
  /** Absolute http or https address, without the fragment. */
  url: string;
}

export interface ReducedCareersPage {
  /** Visible text in document order. Scripts and styles are dropped. */
  text: string;
  /** Links in document order, deduplicated, at most `MAX_LINKS`. */
  links: CareersLink[];
}

/** Reduces an HTML page to its visible text and its absolute links. Relative links resolve against `pageUrl`. */
export function reduceCareersPage(html: string, pageUrl: string): ReducedCareersPage {
  const $ = load(html);
  const seen = new Set<string>();
  const links: CareersLink[] = [];

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href") ?? "";
    let url: URL;
    try {
      url = new URL(href, pageUrl);
    } catch {
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    url.hash = "";
    const absolute = url.toString();
    if (seen.has(absolute)) return;
    seen.add(absolute);
    if (links.length >= MAX_LINKS) return;
    const label =
      collapseWhitespace($(element).text()) ||
      collapseWhitespace($(element).attr("aria-label") ?? $(element).attr("title") ?? "");
    links.push({ text: label.slice(0, LINK_TEXT_MAX), url: absolute });
  });

  return { text: htmlToText(html), links };
}
