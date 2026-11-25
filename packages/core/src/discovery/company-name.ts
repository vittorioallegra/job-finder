/**
 * A company's name reduced to what identifies it: lower case, no accents, no legal form or country
 * word ("S.p.A.", "GmbH", "Italia"), letters and digits only. "ALLNET.ITALIA S.p.A." and "Allnet"
 * are the same company; "Fineco" and "Fineco Banca Privada Kutxabank" are not.
 */
export function normalizeCompanyName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(
      /\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?a\.?s\.?|gmbh|inc\.?|ltd\.?|llc|ag|b\.?v\.?|plc|corp\.?|co\.|group|gruppo|italia|italy|jobs? at)\b/g,
      " ",
    )
    .replace(/[^a-z0-9]+/g, "");
}

/** True when two names are the same company once reduced. */
export function sameCompany(a: string, b: string): boolean {
  const left = normalizeCompanyName(a);
  const right = normalizeCompanyName(b);
  return left !== "" && left === right;
}
