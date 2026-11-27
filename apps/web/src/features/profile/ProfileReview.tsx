import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClipboardCheck, Sparkles } from "lucide-react";
import { Link } from "react-router";
import {
  aiConsentTarget,
  type AiProfileReview,
  type ProfileReviewFailureCode,
  type ProfileReviewView,
  type RuleFinding,
} from "@job-finder/bridge";
import { useBridge } from "../../lib/bridge/BridgeContext";
import { useAiConsent } from "../../lib/useAiConsent";
import { Badge, type BadgeTone } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { CheckboxInput } from "../../components/ui/CheckboxInput";

type LoadState =
  { status: "loading" } | { status: "error" } | { status: "ready"; view: ProfileReviewView };

const SEVERITY_TONE: Record<RuleFinding["severity"], BadgeTone> = {
  high: "danger",
  medium: "fair",
  low: "neutral",
};

/** Rules whose sentence changes with a count: i18next picks the `_one` or `_other` form. */
const COUNTED = new Set(["experience-no-bullets", "experience-no-dates", "few-skills"]);

/**
 * The review of the saved profile: the checks that need no AI (what is empty, thin or unproven, and
 * the skills the postings for the roles ask for), then a written review the user asks the AI for.
 * It only advises; nothing here edits the profile. The screen mounts it with the profile version as its
 * key, so it reads again after a save.
 */
export function ProfileReview() {
  const { t, i18n } = useTranslation();
  const bridge = useBridge();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [aiTarget, setAiTarget] = useState<string | null>(null);
  const [providerName, setProviderName] = useState("");
  const { consent, consentTarget, setConsent } = useAiConsent(aiTarget);
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<ProfileReviewFailureCode | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([bridge.profile.review(), bridge.settings.get()]).then(
      ([view, settings]) => {
        if (!active) return;
        setState({ status: "ready", view });
        setAiTarget(aiConsentTarget(settings.ai));
        setProviderName(t(`settings.ai.providers.${settings.ai.provider}`));
      },
      () => {
        if (active) setState({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
    // `t` changes with the language, which does not change what is loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, attempt]);

  async function review() {
    if (state.status !== "ready") return;
    setRunning(true);
    setFailure(null);
    try {
      const result = await bridge.profile.reviewAi({ consent, consentTarget });
      if (result.ok) {
        setState({
          status: "ready",
          view: {
            ...state.view,
            ai: {
              ...state.view.ai,
              needsConsent: false,
              review: result.review,
              reviewedAt: result.reviewedAt,
            },
          },
        });
      } else {
        setFailure(result.code);
      }
    } catch {
      setFailure("engine-unavailable");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card as="section" aria-labelledby="profile-review-title" className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <ClipboardCheck aria-hidden="true" className="size-4 text-app-accent" strokeWidth={1.8} />
        <CardTitle id="profile-review-title">{t("profile.review.title")}</CardTitle>
      </div>
      <p className="text-sm text-app-muted">{t("profile.review.intro")}</p>

      {state.status === "loading" ? (
        <p role="status" className="text-sm text-app-muted">
          {t("profile.review.loading")}
        </p>
      ) : null}

      {state.status === "error" ? (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-app-danger">{t("profile.review.loadFailed")}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((count) => count + 1);
            }}
          >
            {t("profile.review.retry")}
          </Button>
        </div>
      ) : null}

      {state.status === "ready" ? (
        <>
          <Checks view={state.view} />
          <WrittenReview
            view={state.view}
            providerName={providerName}
            consent={consent}
            onConsent={setConsent}
            running={running}
            failure={failure}
            onRun={() => void review()}
            locale={i18n.language}
          />
        </>
      ) : null}
    </Card>
  );
}

function Checks({ view }: { view: ProfileReviewView }) {
  const { t } = useTranslation();
  return (
    <section aria-label={t("profile.review.checks")} className="flex flex-col gap-2">
      <h3 className="font-sans text-sm font-semibold text-app-fg">{t("profile.review.checks")}</h3>
      {view.findings.length === 0 ? (
        <p className="text-sm text-app-good">{t("profile.review.noFindings")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {view.findings.map((finding, index) => (
            <li
              key={`${finding.code}-${index}`}
              className="flex items-start gap-3 rounded-lg bg-app-sunken px-3 py-2"
            >
              <Badge tone={SEVERITY_TONE[finding.severity]} className="mt-0.5 shrink-0">
                {t(`profile.review.severity.${finding.severity}`)}
              </Badge>
              <div className="min-w-0">
                <p className="text-sm text-app-fg">
                  {t(`profile.review.rules.${finding.code}`, {
                    ...finding.params,
                    ...(COUNTED.has(finding.code)
                      ? { count: Number(finding.params["count"]) }
                      : {}),
                  })}
                </p>
                <p className="text-xs text-app-muted">
                  {t(`profile.review.sections.${finding.section}`)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {view.marketJobs >= 20 ? (
        <p className="text-xs text-app-muted">
          {t("profile.review.market", { count: view.marketJobs })}
        </p>
      ) : null}
    </section>
  );
}

interface WrittenReviewProps {
  view: ProfileReviewView;
  providerName: string;
  consent: boolean;
  onConsent: (value: boolean) => void;
  running: boolean;
  failure: ProfileReviewFailureCode | null;
  onRun: () => void;
  locale: string;
}

function WrittenReview({
  view,
  providerName,
  consent,
  onConsent,
  running,
  failure,
  onRun,
  locale,
}: WrittenReviewProps) {
  const { t } = useTranslation();
  const { ai } = view;
  if (!view.hasProfile) return null;
  return (
    <section
      aria-label={t("profile.review.ai.title")}
      className="flex flex-col gap-3 border-t border-app-border pt-4"
    >
      <div className="flex items-center gap-2">
        <Sparkles aria-hidden="true" className="size-4 text-app-accent" strokeWidth={1.8} />
        <h3 className="font-sans text-sm font-semibold text-app-fg">
          {t("profile.review.ai.title")}
        </h3>
      </div>

      {!ai.enabled ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-sm text-app-muted">{t("profile.review.ai.off")}</p>
          <Link to="/settings" className="text-sm text-app-accent underline">
            {t("profile.review.ai.openSettings")}
          </Link>
        </div>
      ) : (
        <>
          {ai.review === null ? (
            <p className="text-sm text-app-muted">{t("profile.review.ai.intro")}</p>
          ) : (
            <ReviewBody review={ai.review} />
          )}
          {ai.review !== null && ai.reviewedAt !== null ? (
            <p className="text-xs text-app-muted">
              {t("profile.review.ai.reviewedAt", {
                date: new Date(ai.reviewedAt).toLocaleString(locale),
              })}
            </p>
          ) : null}
          {ai.needsConsent ? (
            <div className="flex flex-col gap-2 rounded-lg bg-app-sunken p-3">
              <p className="text-sm text-app-fg">
                {t("profile.review.ai.consentNote", { provider: providerName })}
              </p>
              <CheckboxInput
                label={t("profile.review.ai.consent", { provider: providerName })}
                checked={consent}
                onChange={(event) => onConsent(event.target.checked)}
              />
            </div>
          ) : null}
          {running ? (
            <p role="status" className="text-sm text-app-muted">
              {t("profile.review.ai.running")}
            </p>
          ) : null}
          {failure !== null ? (
            <p role="alert" className="text-sm text-app-danger">
              {t(`profile.review.failures.${failure}`)}
            </p>
          ) : null}
          <div>
            <Button
              variant="secondary"
              size="sm"
              onClick={onRun}
              disabled={running || (ai.needsConsent && !consent)}
            >
              {ai.review === null ? t("profile.review.ai.start") : t("profile.review.ai.again")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function ReviewBody({ review }: { review: AiProfileReview }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-app-fg">{review.summary}</p>
      {review.suggestions.length === 0 ? (
        <p className="text-sm text-app-muted">{t("profile.review.ai.noSuggestions")}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {review.suggestions.map((item, index) => (
            <li key={index} className="flex flex-col gap-1 rounded-lg bg-app-sunken px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-app-fg">{item.title}</p>
                <Badge tone="accent">{t(`profile.review.sections.${item.section}`)}</Badge>
              </div>
              <p className="text-sm text-app-fg">{item.advice}</p>
              {item.example !== "" ? (
                <p className="text-sm text-app-muted">
                  {t("profile.review.ai.example")} <span className="italic">{item.example}</span>
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
