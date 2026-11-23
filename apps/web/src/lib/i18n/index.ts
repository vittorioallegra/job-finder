import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import it from "./it.json";

export const SUPPORTED_LANGUAGES = ["en", "it"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Picks the first supported language from the browser list; English otherwise. */
export function detectLanguage(languages: readonly string[]): SupportedLanguage {
  for (const candidate of languages) {
    const base = candidate.toLowerCase().split("-")[0];
    if (base === "en" || base === "it") {
      return base;
    }
  }
  return "en";
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, it: { translation: it } },
  lng: detectLanguage(navigator.languages),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

export { i18n };
