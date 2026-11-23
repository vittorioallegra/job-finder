import { load } from "cheerio";

const BLOCK_SELECTOR = "p,li,br,div,h1,h2,h3,h4,h5,h6,tr";

/**
 * Plain text of an HTML fragment. Scripts and styles are dropped, block boundaries become line
 * breaks, and runs of whitespace collapse. Entities are decoded by the parser.
 */
export function htmlToText(html: string): string {
  const $ = load(html);
  $("script,style,template").remove();
  $(BLOCK_SELECTOR).after("\n");
  return collapse($.root().text());
}

/**
 * Some APIs return HTML escaped inside a JSON string (`&lt;p&gt;`). Decode that layer first, then
 * strip the markup.
 */
export function escapedHtmlToText(escaped: string): string {
  return htmlToText(load(escaped).root().text());
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function collapse(value: string): string {
  return value
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Lower case, accents removed, punctuation turned into single spaces. For matching only. */
export function foldForMatch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}/+-]+/gu, " ")
    .trim();
}
