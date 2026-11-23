/**
 * Escapes one CSV field. Quotes and line breaks are quoted; a value that a spreadsheet would read as
 * a formula gets a leading apostrophe. That is a value whose first character, after leading
 * whitespace and a full-width to ASCII fold (＝ ＋ － ＠), is = + - @, a tab or a carriage return.
 */
export function csvField(value: string | number | null): string {
  if (value === null) return "";
  let text = String(value);
  const folded = text.normalize("NFKC").replace(/^[\s\u200b\ufeff]+/, "");
  if (typeof value === "string" && (/^[=+\-@]/.test(folded) || /^[\t\r]/.test(text))) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One CSV line per row, CRLF-separated, with a header line. */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number | null)[])[],
): string {
  const lines = [header, ...rows].map((row) => row.map((cell) => csvField(cell)).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
