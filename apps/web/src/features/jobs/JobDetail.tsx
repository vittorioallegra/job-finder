import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type {
  ApplicationStartResult,
  ApplicationStatus,
  DuplicateApplication,
  DuplicateCheck,
  JobDetail as JobDetailRecord,
} from "@job-finder/bridge";
import { useBridge } from "../../lib/bridge/BridgeContext";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";

type DetailState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "missing" }
  | { status: "ready"; job: JobDetailRecord };

/** The duplicate warning steps: one confirmation for the same company, two for the same job. */
type PrepareState =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "warning"; duplicates: DuplicateCheck; confirmed: number }
  | { status: "done"; applicationStatus: ApplicationStatus }
  | { status: "failed" };

interface JobDetailProps {
  jobId: string;
  /** Called after a flag changes, so the results show the new state. */
  onChanged: () => void;
  onClose: () => void;
}

/**
 * One job with its description and every source that lists it. Opening it marks the job viewed;
 * dismissing hides it from the results until the filter shows dismissed jobs.
 */
export function JobDetail({ jobId, onChanged, onClose }: JobDetailProps) {
  const { t, i18n } = useTranslation();
  const bridge = useBridge();
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const changedRef = useRef(onChanged);
  useEffect(() => {
    changedRef.current = onChanged;
  }, [onChanged]);

  useEffect(() => {
    let active = true;
    void bridge.jobs
      .detail({ jobId })
      .then(async (job) => {
        if (!active) return;
        if (job === null) {
          setState({ status: "missing" });
          return;
        }
        setState({ status: "ready", job });
        if (job.isNew) {
          await bridge.jobs.flag({ jobId, viewed: true });
          if (active) changedRef.current();
        }
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [bridge, jobId, attempt]);

  const [prepare, setPrepare] = useState<PrepareState>({ status: "idle" });

  /** Starts the application with the confirmations given, then reflects its status. */
  async function start(confirmations: number) {
    if (state.status !== "ready") return;
    setPrepare({ status: "busy" });
    let result: ApplicationStartResult;
    try {
      result = await bridge.applications.start({ jobId, confirmations });
    } catch {
      setPrepare({ status: "failed" });
      return;
    }
    if (result.ok) {
      const applicationStatus = result.application.status;
      setState({ status: "ready", job: { ...state.job, applicationStatus } });
      setPrepare({ status: "done", applicationStatus });
      onChanged();
    } else if (result.code === "duplicate-confirmation-required") {
      setPrepare({ status: "warning", duplicates: result.duplicates, confirmed: confirmations });
    } else {
      setPrepare({ status: "failed" });
    }
  }

  /** Reads the duplicate warning first; without one the application starts at once. */
  async function startPreparing() {
    setPrepare({ status: "busy" });
    try {
      const duplicates = await bridge.applications.check({ jobId });
      if (duplicates.requiredConfirmations === 0) {
        await start(0);
      } else {
        setPrepare({ status: "warning", duplicates, confirmed: 0 });
      }
    } catch {
      setPrepare({ status: "failed" });
    }
  }

  /** Bookmarks the job, or removes the bookmark. Both are the bookmarked application. */
  async function setBookmarked(bookmarked: boolean) {
    if (state.status !== "ready") return;
    try {
      await bridge.applications.bookmark({ jobId, bookmarked });
      const applicationStatus = bookmarked ? "bookmarked" : null;
      setState({ status: "ready", job: { ...state.job, applicationStatus } });
      onChanged();
    } catch {
      setState({ status: "error" });
    }
  }

  /** One explicit confirmation of the warning; the application starts once the count is reached. */
  function confirmWarning() {
    if (prepare.status !== "warning") return;
    const confirmed = prepare.confirmed + 1;
    if (confirmed >= prepare.duplicates.requiredConfirmations) {
      void start(confirmed);
    } else {
      setPrepare({ ...prepare, confirmed });
    }
  }

  async function setDismissed(dismissed: boolean) {
    if (state.status !== "ready") return;
    try {
      await bridge.jobs.flag({ jobId, dismissed });
      setState({ status: "ready", job: { ...state.job, dismissed } });
      onChanged();
    } catch {
      setState({ status: "error" });
    }
  }

  const formatDate = (epochMs: number) => new Date(epochMs).toLocaleDateString(i18n.language);
  const notStated = t("jobs.detail.notStated");
  const salary = state.status === "ready" ? state.job.salary : null;
  const salaryText = (() => {
    if (state.status !== "ready" || salary === null) return notStated;
    const { min, max, currency, period } = salary;
    const amount =
      min !== undefined && max !== undefined ? `${min}-${max}` : String(min ?? max ?? "");
    const unit = period ? ` / ${t(`jobs.filters.values.period.${period}`)}` : "";
    return `${currency ? `${currency} ` : ""}${amount}${unit}`;
  })();

  return (
    <section aria-labelledby="jobs-detail-title" className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <h3
          id="jobs-detail-title"
          className="font-display text-3xl leading-tight font-semibold text-app-fg"
        >
          {state.status === "ready" ? state.job.title : t("jobs.detail.heading")}
        </h3>
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t("jobs.detail.close")}
        </Button>
      </div>

      {state.status === "loading" ? (
        <p role="status" className="text-sm text-app-muted">
          {t("jobs.detail.loading")}
        </p>
      ) : null}
      {state.status === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-sm text-app-fg">{t("jobs.detail.loadFailed")}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((value) => value + 1);
            }}
          >
            {t("jobs.detail.retry")}
          </Button>
        </div>
      ) : null}
      {state.status === "missing" ? (
        <p className="text-sm text-app-muted">{t("jobs.detail.missing")}</p>
      ) : null}

      {state.status === "ready" ? (
        <>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-app-muted">
                {state.job.companyName} ·{" "}
                {state.job.locations.length > 0
                  ? state.job.locations.join(" / ")
                  : t("jobs.results.noLocation")}
              </p>
              {state.job.closedAt !== null ? (
                <Badge tone="weak">{t("jobs.detail.closed")}</Badge>
              ) : null}
              {state.job.applicationStatus !== null ? (
                <Badge tone="accent">
                  {t("jobs.results.applicationStatus", {
                    status: t(`applications.status.${state.job.applicationStatus}`),
                  })}
                </Badge>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {state.job.workMode !== "unknown" ? (
                <Badge>{t(`jobs.results.workMode.${state.job.workMode}`)}</Badge>
              ) : null}
              {state.job.employmentType !== "unknown" ? (
                <Badge>
                  {t(`jobs.filters.values.employment.${state.job.employmentType}`, {
                    defaultValue: state.job.employmentType,
                  })}
                </Badge>
              ) : null}
              {state.job.seniority !== "unknown" ? (
                <Badge>
                  {t(`jobs.filters.values.seniority.${state.job.seniority}`, {
                    defaultValue: state.job.seniority,
                  })}
                </Badge>
              ) : null}
            </div>
          </div>

          <PreparePanel
            prepare={prepare}
            onPrepare={() => void startPreparing()}
            onConfirm={confirmWarning}
            onCancel={() => setPrepare({ status: "idle" })}
            formatDate={formatDate}
            actions={
              <>
                <Button variant="secondary" onClick={() => void setDismissed(!state.job.dismissed)}>
                  {state.job.dismissed ? t("jobs.detail.restore") : t("jobs.detail.dismiss")}
                </Button>
                {state.job.applicationStatus === null ||
                state.job.applicationStatus === "bookmarked" ? (
                  <Button
                    variant="secondary"
                    aria-pressed={state.job.applicationStatus === "bookmarked"}
                    onClick={() => void setBookmarked(state.job.applicationStatus === null)}
                  >
                    {state.job.applicationStatus === "bookmarked"
                      ? t("jobs.detail.removeBookmark")
                      : t("jobs.detail.bookmark")}
                  </Button>
                ) : null}
              </>
            }
          />

          <Card as="div" className="bg-app-sunken/40">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-app-muted">{t("jobs.detail.visa")}</dt>
              <dd className="text-app-fg">{t(`jobs.filters.visa.${state.job.visaSponsorship}`)}</dd>
              <dt className="text-app-muted">{t("jobs.detail.language")}</dt>
              <dd className="text-app-fg">
                {languageName(state.job.language, i18n.language) ?? notStated}
              </dd>
              <dt className="text-app-muted">{t("jobs.detail.salary")}</dt>
              <dd className="text-app-fg">{salaryText}</dd>
            </dl>
          </Card>

          {state.job.score === null ? (
            <p className="text-sm font-medium text-app-muted">{t("jobs.results.notScored")}</p>
          ) : (
            <div className="flex flex-col gap-1.5 rounded-2xl bg-app-accent-soft p-4">
              <p className="text-sm font-semibold text-app-fg">
                {t("jobs.results.affinity", { score: state.job.score })}
              </p>
              {state.job.explanation ? (
                <p className="text-sm text-app-muted">{state.job.explanation}</p>
              ) : null}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <h4 className="font-sans text-sm font-semibold text-app-fg">
              {t("jobs.detail.description")}
            </h4>
            <p className="text-sm leading-relaxed whitespace-pre-line text-app-fg">
              {state.job.description === ""
                ? t("jobs.detail.noDescription")
                : state.job.description}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <h4 className="font-sans text-sm font-semibold text-app-fg">
              {t("jobs.detail.sources")}
            </h4>
            {state.job.sources.length === 0 ? (
              <p className="text-sm text-app-muted">{t("jobs.detail.noSources")}</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {state.job.sources.map((source) => (
                  <li
                    key={`${source.source}-${source.url}`}
                    className="flex flex-col gap-0.5 rounded-xl border border-app-border bg-app-surface p-3"
                  >
                    <span className="font-medium text-app-fg">
                      {source.source}
                      {source.closed ? ` · ${t("jobs.detail.sourceClosed")}` : ""}
                    </span>
                    <span className="break-all text-xs text-app-muted">
                      {t("jobs.detail.postingUrl", { url: source.url })}
                    </span>
                    <span className="break-all text-xs text-app-muted">
                      {t("jobs.detail.applyUrl", { url: source.applyUrl })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

interface PreparePanelProps {
  prepare: PrepareState;
  onPrepare: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  formatDate: (epochMs: number) => string;
  /** Secondary actions shown next to the prepare button. */
  actions: ReactNode;
}

/**
 * Starts preparing the job. A duplicate warning shows the earlier applications and asks for one
 * confirmation (same company) or two (same job or fingerprint).
 */
function PreparePanel({
  prepare,
  onPrepare,
  onConfirm,
  onCancel,
  formatDate,
  actions,
}: PreparePanelProps) {
  const { t } = useTranslation();
  if (prepare.status === "warning") {
    const { duplicates, confirmed } = prepare;
    const earlier = duplicates.sameJob.length > 0 ? duplicates.sameJob : duplicates.sameCompany;
    const warning =
      duplicates.sameJob.length > 0
        ? "jobs.detail.prepareCheck.sameJobWarning"
        : "jobs.detail.prepareCheck.sameCompanyWarning";
    return (
      <div className="flex flex-col gap-3">
        <div role="alert" className="flex flex-col gap-3 rounded-2xl bg-app-fair-soft p-4">
          <p className="text-sm font-semibold text-app-fg">
            {t(warning, { count: earlier.length })}
          </p>
          <ul className="flex flex-col gap-1 text-sm text-app-muted">
            {earlier.map((item: DuplicateApplication) => (
              <li key={item.id}>
                {t("jobs.detail.prepareCheck.previous", {
                  title: item.jobTitle,
                  company: item.companyName,
                  status: t(`applications.status.${item.status}`),
                  date: formatDate(item.statusChangedAt),
                })}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onConfirm}>
              {t(
                confirmed === 0
                  ? "jobs.detail.prepareCheck.confirmOnce"
                  : "jobs.detail.prepareCheck.confirmAgain",
              )}
            </Button>
            <Button variant="secondary" size="sm" onClick={onCancel}>
              {t("jobs.detail.prepareCheck.cancel")}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onPrepare} disabled={prepare.status === "busy"}>
          {t("jobs.detail.prepare")}
        </Button>
        {actions}
      </div>
      {prepare.status === "done" ? (
        <p role="status" className="text-sm text-app-good">
          {t("jobs.detail.prepared", {
            status: t(`applications.status.${prepare.applicationStatus}`),
          })}
        </p>
      ) : null}
      {prepare.status === "failed" ? (
        <p role="alert" className="text-sm text-app-danger">
          {t("jobs.detail.prepareCheck.failed")}
        </p>
      ) : null}
    </div>
  );
}

/** "en" as "English" (or "inglese") in the UI language; the code itself when the runtime has no name. */
function languageName(code: string | null, uiLanguage: string): string | null {
  if (code === null) return null;
  try {
    return new Intl.DisplayNames([uiLanguage], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}
