import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, ClipboardCheck, Sparkles } from "lucide-react";
import { Link } from "react-router";
import {
  aiConsentTarget,
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
  // The findings sit in an accordion: open at first, and opened again when a written review arrives.
  const [open, setOpen] = useState(true);

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
        setOpen(true);
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

  const view = state.status === "ready" ? state.view : null;
  const aiOn = view?.ai.enabled ?? false;
  const needsConsent = view?.ai.needsConsent ?? false;

  return (
    <Card as="section" aria-labelledby="profile-review-title" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ClipboardCheck aria-hidden="true" className="size-4 text-app-accent" strokeWidth={1.8} />
          <CardTitle id="profile-review-title">{t("profile.review.title")}</CardTitle>
        </div>
        {view !== null && view.hasProfile ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void review()}
            disabled={!aiOn || running || (needsConsent && !consent)}
          >
            <Sparkles aria-hidden="true" className="size-4" strokeWidth={1.8} />
            {t("profile.review.evaluate")}
          </Button>
        ) : null}
      </div>

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

      {view !== null ? (
        <>
          {!aiOn ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="text-sm text-app-muted">{t("profile.review.ai.off")}</p>
              <Link to="/settings" className="text-sm text-app-accent underline">
                {t("profile.review.ai.openSettings")}
              </Link>
            </div>
          ) : null}
          {aiOn && needsConsent ? (
            <div className="flex flex-col gap-2 rounded-lg bg-app-sunken p-3">
              <p className="text-sm text-app-fg">
                {t("profile.review.ai.consentNote", { provider: providerName })}
              </p>
              <CheckboxInput
                label={t("profile.review.ai.consent", { provider: providerName })}
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
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
          <Findings view={view} locale={i18n.language} open={open} onToggle={setOpen} />
        </>
      ) : null}
    </Card>
  );
}

/** Everything the review found in one list: the checks first, then what the AI wrote. */
function Findings({
  view,
  locale,
  open,
  onToggle,
}: {
  view: ProfileReviewView;
  locale: string;
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { review, reviewedAt } = view.ai;
  if (!view.hasProfile) return null;
  const empty = view.findings.length === 0 && review === null;
  const count = view.findings.length + (review?.suggestions.length ?? 0);
  return (
    <details
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
      className="group rounded-xl border border-app-border"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-4 text-app-muted transition-transform group-open:rotate-90"
          strokeWidth={1.8}
        />
        <h3 className="font-sans text-sm font-semibold text-app-fg">
          {empty ? t("profile.review.noFindings") : t("profile.review.summary", { count })}
        </h3>
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4">
        {review !== null ? <p className="text-sm text-app-fg">{review.summary}</p> : null}
        <ul className="flex flex-col gap-1.5">
          {view.findings.map((finding, index) => (
            <Row
              key={`${finding.code}-${index}`}
              badge={
                <Badge tone={SEVERITY_TONE[finding.severity]}>
                  {t(`profile.review.severity.${finding.severity}`)}
                </Badge>
              }
              section={t(`profile.review.sections.${finding.section}`)}
            >
              <p className="text-sm text-app-fg">
                {t(`profile.review.rules.${finding.code}`, {
                  ...finding.params,
                  ...(COUNTED.has(finding.code) ? { count: Number(finding.params["count"]) } : {}),
                })}
              </p>
            </Row>
          ))}
          {review?.suggestions.map((item, index) => (
            <Row
              key={`ai-${index}`}
              badge={<Badge tone="accent">{t("profile.review.ai.badge")}</Badge>}
              section={t(`profile.review.sections.${item.section}`)}
            >
              <p className="text-sm font-medium text-app-fg">{item.title}</p>
              <p className="text-sm text-app-fg">{item.advice}</p>
              {item.example !== "" ? (
                <p className="text-sm text-app-muted">
                  {t("profile.review.ai.example")} <span className="italic">{item.example}</span>
                </p>
              ) : null}
            </Row>
          ))}
        </ul>
        {review !== null && review.suggestions.length === 0 ? (
          <p className="text-sm text-app-muted">{t("profile.review.ai.noSuggestions")}</p>
        ) : null}
        {view.marketJobs >= 20 ? (
          <p className="text-xs text-app-muted">
            {t("profile.review.market", { count: view.marketJobs })}
          </p>
        ) : null}
        {review !== null && reviewedAt !== null ? (
          <p className="text-xs text-app-muted">
            {t("profile.review.ai.reviewedAt", {
              date: new Date(reviewedAt).toLocaleString(locale),
            })}
          </p>
        ) : null}
      </div>
    </details>
  );
}

function Row({
  badge,
  section,
  children,
}: {
  badge: ReactNode;
  section: string;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 rounded-lg bg-app-sunken px-3 py-2">
      <span className="mt-0.5 shrink-0">{badge}</span>
      <div className="min-w-0">
        {children}
        <p className="text-xs text-app-muted">{section}</p>
      </div>
    </li>
  );
}
