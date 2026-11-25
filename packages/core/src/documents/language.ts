/**
 * The language a CV or cover letter is written in. The two languages the prompts and the document
 * labels support (en, it): a posting in another language falls back to the UI language. Kept free of
 * Node imports so the bridge can use it; the same set as `EXPLANATION_LANGUAGES` in ranking.
 */
export const DOCUMENT_LANGUAGES = ["en", "it"] as const;
export type DocumentLanguage = (typeof DOCUMENT_LANGUAGES)[number];

export interface DocumentLanguageChoice {
  language: DocumentLanguage;
  /**
   * "chosen": the user picked it for this application. "posting": the normalized language of the
   * job. "ui": the UI language (no or unsupported posting language).
   */
  source: "chosen" | "posting" | "ui";
}

/** The language a document uses when the user has not chosen one: the posting's, else the UI's. A language the user chose for the application wins (the callers apply it). */
export function documentLanguageFor(
  postingLanguage: string | null | undefined,
  uiLanguage: DocumentLanguage,
): DocumentLanguageChoice {
  const supported = DOCUMENT_LANGUAGES.find((code) => code === postingLanguage);
  return supported !== undefined
    ? { language: supported, source: "posting" }
    : { language: uiLanguage, source: "ui" };
}
