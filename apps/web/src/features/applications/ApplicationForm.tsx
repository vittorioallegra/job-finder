import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type {
  ApplicationDetail as ApplicationDetailRecord,
  AutofillFailureCode,
  AutofillStartResult,
  AiTestFailureCode,
} from "@job-finder/bridge";
import { aiConsentTarget, isCloudAiEndpoint } from "@job-finder/bridge";
import { useAiConsent } from "../../lib/useAiConsent";
import { useBridge } from "../../lib/bridge/BridgeContext";
import { Badge } from "../../components/ui/Badge";
import { Button, buttonClass } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { CheckboxInput } from "../../components/ui/CheckboxInput";

interface ApplicationFormProps {
  application: ApplicationDetailRecord;
  /** Called after the status changes, so the list and the detail show it. */
  onChanged: (application: ApplicationDetailRecord) => void;
}

/** The AI settings as the fallback needs them: whether a provider is set up, and whether it is a cloud one. */
interface AiState {
  configured: boolean;
  cloud: boolean;
  provider: string;
  target: string;
}

/**
 * Opens the application's form in its own window and fills it from the profile. The form window is
 * the user's to review and submit; this panel only confirms "I submitted it", which moves the
 * application to applied. Closing the window without confirming leaves it ready. The AI fallback
 * maps the fields the rules leave; it runs only when asked, and after consent for a cloud provider.
 */
export function ApplicationForm({ application, onChanged }: ApplicationFormProps) {
  const { t } = useTranslation();
  const bridge = useBridge();
  const [busy, setBusy] = useState<"open" | "submit" | null>(null);
  const [result, setResult] = useState<AutofillStartResult | null>(null);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [ai, setAi] = useState<AiState | null>(null);
  const [aiFallback, setAiFallback] = useState(false);

  const [aiLoadFailed, setAiLoadFailed] = useState(false);
  const [aiAttempt, setAiAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    bridge.settings
      .get()
      .then((settings) => {
        if (!active) return;
        const { ai: aiSettings } = settings;
        setAi({
          configured:
            aiSettings.model.trim() !== "" &&
            (aiSettings.provider !== "openai-compatible" || aiSettings.baseUrl.trim() !== ""),
          cloud: isCloudAiEndpoint(aiSettings),
          target: aiConsentTarget(aiSettings),
          provider: t(`settings.ai.providers.${aiSettings.provider}`),
        });
      })
      .catch(() => {
        if (active) setAiLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [bridge, t, aiAttempt]);

  const { consent, consentTarget, setConsent } = useAiConsent(ai?.target ?? null);
  const available = application.status === "preparing" || application.status === "ready";
  const needsConsent = aiFallback && ai !== null && ai.cloud && ai.configured;
  const openDisabled = busy !== null || (needsConsent && !consent);

  async function open() {
    setBusy("open");
    setResult(null);
    setSubmitted(false);
    setSubmitFailed(false);
    try {
      setResult(
        await bridge.autofill.start({
          applicationId: application.id,
          aiFallback,
          consent,
          consentTarget,
        }),
      );
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

  function aiReasonText(code: AiTestFailureCode): string {
    return t(`applications.form.ai.reasons.${code}`, {
      defaultValue: t("applications.form.ai.reasons.unknown"),
    });
  }

  return (
    <Card as="section" aria-labelledby="application-form-title" className="flex flex-col gap-3">
      <CardTitle level={3} id="application-form-title">
        {t("applications.form.heading")}
      </CardTitle>
      <p className="text-sm text-app-muted">{t("applications.form.intro")}</p>

      {!available ? (
        <p className="text-sm text-app-muted">{t("applications.form.inactive")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {aiLoadFailed ? (
            <div className="flex flex-col items-start gap-2">
              <p role="alert" className="text-sm text-app-danger">
                {t("applications.form.ai.loadFailed")}
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setAiLoadFailed(false);
                  setAiAttempt((n) => n + 1);
                }}
              >
                {t("applications.form.ai.retry")}
              </Button>
            </div>
          ) : null}
          {ai !== null && !ai.configured ? (
            <div className="flex flex-col items-start gap-2">
              <p role="status" className="text-sm text-app-fg">
                {t("applications.form.ai.notConfigured")}
              </p>
              <Link to="/settings" className={buttonClass("secondary", "sm")}>
                {t("applications.form.ai.openSettings")}
              </Link>
            </div>
          ) : null}
          {ai !== null && ai.configured ? (
            <div className="flex flex-col gap-2">
              <CheckboxInput
                label={t("applications.form.ai.useAi")}
                hint={t("applications.form.ai.useAiHint")}
                checked={aiFallback}
                onChange={(event) => setAiFallback(event.target.checked)}
              />
              {aiFallback && ai.cloud ? (
                <>
                  <p className="text-sm text-app-muted">
                    {t("applications.form.ai.consentNote", { provider: ai.provider })}
                  </p>
                  <CheckboxInput
                    label={t("applications.form.ai.consent", { provider: ai.provider })}
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                  />
                </>
              ) : null}
            </div>
          ) : null}
          <div>
            <Button
              variant="secondary"
              size="sm"
              disabled={openDisabled || (ai === null && !aiLoadFailed)}
              onClick={() => void open()}
            >
              {busy === "open" ? t("applications.form.opening") : t("applications.form.open")}
            </Button>
          </div>
        </div>
      )}

      {result !== null && !result.ok ? (
        <p role="alert" className="text-sm text-app-danger">
          {failureText(result.code)}
        </p>
      ) : null}

      {result !== null && result.ok ? (
        <div className="flex flex-col gap-2">
          <p role="status" className="text-sm text-app-good">
            {t("applications.form.opened")}
          </p>
          <p>
            <Badge>
              {t("applications.form.provider", {
                provider: t(`applications.form.providers.${result.provider}`),
              })}
            </Badge>
          </p>
          {result.ai.state === "unavailable" ? (
            <p role="alert" className="text-sm text-app-danger">
              {t("applications.form.ai.unavailable", { reason: aiReasonText(result.ai.code) })}
            </p>
          ) : null}
          {result.ai.state === "used" ? (
            <p className="text-sm text-app-muted">{t("applications.form.ai.used")}</p>
          ) : null}
          {result.filled.length === 0 && result.unfilled.length === 0 ? (
            <p className="text-sm text-app-muted">{t("applications.form.noFields")}</p>
          ) : (
            <>
              <p className="text-sm text-app-fg">
                {result.filled.length === 0
                  ? t("applications.form.nothingFilled")
                  : t("applications.form.filled", { list: result.filled.join(", ") })}
              </p>
              {result.drafted.length > 0 ? (
                <p role="status" className="text-sm text-app-fg">
                  {t("applications.form.ai.drafted", { list: result.drafted.join(", ") })}
                </p>
              ) : null}
              {result.unfilled.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <h5 className="text-sm font-semibold text-app-fg">
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
          <Button size="sm" disabled={busy !== null} onClick={() => void confirmSubmitted()}>
            {busy === "submit"
              ? t("applications.form.confirming")
              : t("applications.form.submitted")}
          </Button>
        </div>
      ) : null}
      {submitted ? (
        <p role="status" className="text-sm text-app-good">
          {t("applications.form.confirmed")}
        </p>
      ) : null}
      {submitFailed ? (
        <p role="alert" className="text-sm text-app-danger">
          {t("applications.form.confirmFailed")}
        </p>
      ) : null}
    </Card>
  );
}
