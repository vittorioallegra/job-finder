import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ApplicationDetail as ApplicationDetailRecord,
  AutofillFailureCode,
  AutofillStartResult,
} from "@job-finder/bridge";
import { useBridge } from "../../lib/bridge/BridgeContext";
import { Button } from "../../components/ui/Button";

interface ApplicationFormProps {
  application: ApplicationDetailRecord;
  /** Called after the status changes, so the list and the detail show it. */
  onChanged: (application: ApplicationDetailRecord) => void;
}

/**
 * Opens the application's form in its own window and fills it from the profile. The form window is
 * the user's to review and submit; this panel only confirms "I submitted it", which moves the
 * application to applied. Closing the window without confirming leaves it ready.
 */
export function ApplicationForm({ application, onChanged }: ApplicationFormProps) {
  const { t } = useTranslation();
  const bridge = useBridge();
  const [busy, setBusy] = useState<"open" | "submit" | null>(null);
  const [result, setResult] = useState<AutofillStartResult | null>(null);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const available = application.status === "preparing" || application.status === "ready";

  async function open() {
    setBusy("open");
    setResult(null);
    setSubmitted(false);
    setSubmitFailed(false);
    try {
      setResult(await bridge.autofill.start({ applicationId: application.id }));
    } catch {
      setResult({ ok: false, code: "autofill-failed" });
    } finally {
      setBusy(null);
    }
  }

  async function confirmSubmitted() {
    setBusy("submit");
    setSubmitFailed(false);
    try {
      const update = await bridge.applications.update({
        applicationId: application.id,
        status: "applied",
      });
      if (update.ok) {
        setSubmitted(true);
        onChanged(update.application);
      } else {
        setSubmitFailed(true);
      }
    } catch {
      setSubmitFailed(true);
    } finally {
      setBusy(null);
    }
  }

  function failureText(code: AutofillFailureCode): string {
    return t(`applications.form.failures.${code}`, {
      defaultValue: t("applications.form.failures.unknown"),
    });
  }

  return (
    <section
      aria-labelledby="application-form-title"
      className="flex flex-col gap-3 rounded-lg border border-app-border p-4"
    >
      <h4 id="application-form-title" className="text-sm font-medium text-app-fg">
        {t("applications.form.heading")}
      </h4>
      <p className="text-sm text-app-muted">{t("applications.form.intro")}</p>

      {!available ? (
        <p className="text-sm text-app-muted">{t("applications.form.inactive")}</p>
      ) : (
        <div>
          <Button variant="secondary" disabled={busy !== null} onClick={() => void open()}>
            {busy === "open" ? t("applications.form.opening") : t("applications.form.open")}
          </Button>
        </div>
      )}

      {result !== null && !result.ok ? (
        <p role="alert" className="text-sm text-app-fg">
          {failureText(result.code)}
        </p>
      ) : null}

      {result !== null && result.ok ? (
        <div className="flex flex-col gap-2">
          <p role="status" className="text-sm text-app-fg">
            {t("applications.form.opened")}
          </p>
          <p className="text-sm text-app-muted">
            {t("applications.form.provider", {
              provider: t(`applications.form.providers.${result.provider}`),
            })}
          </p>
          {result.filled.length === 0 && result.unfilled.length === 0 ? (
            <p className="text-sm text-app-muted">{t("applications.form.noFields")}</p>
          ) : (
            <>
              <p className="text-sm text-app-fg">
                {result.filled.length === 0
                  ? t("applications.form.nothingFilled")
                  : t("applications.form.filled", { list: result.filled.join(", ") })}
              </p>
              {result.unfilled.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <h5 className="text-sm font-medium text-app-fg">
                    {t("applications.form.leftHeading")}
                  </h5>
                  <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm text-app-muted">
                    {result.unfilled.map((item, index) => (
                      <li key={`${item.label}-${index}`}>
                        {item.label === ""
                          ? t(`applications.form.reasons.${item.reason}`)
                          : t("applications.form.leftItem", {
                              label: item.label,
                              reason: t(`applications.form.reasons.${item.reason}`),
                            })}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
          <p className="text-sm text-app-muted">{t("applications.form.reviewNote")}</p>
        </div>
      ) : null}

      {result !== null && result.ok && !submitted ? (
        <div className="flex flex-col items-start gap-2">
          <Button
            disabled={busy !== null || application.status !== "ready"}
            onClick={() => void confirmSubmitted()}
          >
            {busy === "submit"
              ? t("applications.form.confirming")
              : t("applications.form.submitted")}
          </Button>
          {application.status !== "ready" ? (
            <p className="text-sm text-app-muted">{t("applications.form.readyFirst")}</p>
          ) : null}
        </div>
      ) : null}
      {submitted ? (
        <p role="status" className="text-sm text-app-fg">
          {t("applications.form.confirmed")}
        </p>
      ) : null}
      {submitFailed ? (
        <p role="alert" className="text-sm text-app-fg">
          {t("applications.form.confirmFailed")}
        </p>
      ) : null}
    </section>
  );
}
