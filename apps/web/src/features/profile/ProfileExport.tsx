import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileDown } from "lucide-react";
import {
  CV_EXPORT_FORMATS,
  DOCUMENT_LANGUAGES,
  type ProfileExportRequest,
} from "@job-finder/bridge";
import { useBridge } from "../../lib/bridge/BridgeContext";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { SelectInput } from "../../components/ui/SelectInput";
import { useAutoDismiss } from "../../lib/useAutoDismiss";

type Outcome = "idle" | "working" | "saved" | "no-profile" | "export-failed";

/**
 * Saves the whole saved profile as a CV, in PDF or Word, in English or Italian. The language sets
 * the headings and dates; the profile's own text stays as the user wrote it.
 */
export function ProfileExport() {
  const { t, i18n } = useTranslation();
  const bridge = useBridge();
  // The languages are the ones the app supports for documents; the first is the UI's, else English.
  const [language, setLanguage] = useState<ProfileExportRequest["language"]>(
    () => DOCUMENT_LANGUAGES.find((code) => i18n.language.startsWith(code)) ?? "en",
  );
  const [format, setFormat] = useState<ProfileExportRequest["format"]>("pdf");
  const [outcome, setOutcome] = useState<Outcome>("idle");
  useAutoDismiss(outcome === "saved", () => setOutcome("idle"));

  async function save() {
    setOutcome("working");
    try {
      const result = await bridge.profile.exportCv({ language, format });
      if (result.ok) setOutcome("saved");
      // The user closed the save dialog: nothing to report.
      else setOutcome(result.code === "cancelled" ? "idle" : result.code);
    } catch {
      setOutcome("export-failed");
    }
  }

  return (
    <Card as="section" aria-labelledby="profile-export-title" className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <FileDown aria-hidden="true" className="size-4 text-app-accent" strokeWidth={1.8} />
        <CardTitle id="profile-export-title">{t("profile.export.title")}</CardTitle>
      </div>
      <p className="text-sm text-app-muted">{t("profile.export.hint")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <SelectInput
            label={t("profile.export.language")}
            options={DOCUMENT_LANGUAGES.map((value) => ({
              value,
              label: t(`applications.documents.language.options.${value}`),
            }))}
            value={language}
            onChange={(event) => setLanguage(event.target.value as typeof language)}
          />
        </div>
        <div className="w-44">
          <SelectInput
            label={t("profile.export.format")}
            options={CV_EXPORT_FORMATS.map((value) => ({
              value,
              label: t(`profile.export.formats.${value}`),
            }))}
            value={format}
            onChange={(event) => setFormat(event.target.value as typeof format)}
          />
        </div>
        <Button variant="secondary" onClick={() => void save()} disabled={outcome === "working"}>
          {outcome === "working" ? t("profile.export.working") : t("profile.export.action")}
        </Button>
        {outcome === "saved" ? (
          <p role="status" className="pb-2 text-sm text-app-good">
            {t("profile.export.done")}
          </p>
        ) : null}
        {outcome === "no-profile" || outcome === "export-failed" ? (
          <p role="alert" className="pb-2 text-sm text-app-danger">
            {t(`profile.export.failures.${outcome}`)}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
