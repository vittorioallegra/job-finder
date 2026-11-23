import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ApplicationStartResult,
  ApplicationStatus,
  DuplicateApplication,
  DuplicateCheck,
  JobDetail as JobDetailRecord,
} from "@job-finder/bridge";
import { useBridge } from "../../lib/bridge/BridgeContext";
import { Button } from "../../components/ui/Button";

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
    <section
      aria-labelledby="jobs-detail-title"
      className="flex flex-col gap-4 rounded-lg border border-app-border p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 id="jobs-detail-title" className="text-lg font-medium text-app-fg">
          {state.status === "ready" ? state.job.title : t("jobs.detail.heading")}
        </h3>
        <Button variant="secondary" onClick={onClose}>
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
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-app-muted">
              {state.job.companyName} ·{" "}
              {state.job.locations.length > 0
                ? state.job.locations.join(" / ")
                : t("jobs.results.noLocation")}
            </p>
            {state.job.closedAt !== null ? (
              <span className="rounded-full border border-app-border px-2 py-0.5 text-xs text-app-muted">
                {t("jobs.detail.closed")}
              </span>
            ) : null}
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
            {state.job.applicationStatus !== null ? (
              <span className="rounded-full border border-app-border px-2 py-0.5 text-xs text-app-fg">
                {t("jobs.results.applicationStatus", {
                  status: t(`applications.status.${state.job.applicationStatus}`),
                })}
              </span>
            ) : null}
          </div>

          <PreparePanel
            prepare={prepare}
            onPrepare={() => void startPreparing()}
            onConfirm={confirmWarning}
            onCancel={() => setPrepare({ status: "idle" })}
            formatDate={formatDate}
          />

          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <dt className="text-app-muted">{t("jobs.detail.workMode")}</dt>
            <dd className="text-app-fg">{t(`jobs.results.workMode.${state.job.workMode}`)}</dd>
            <dt className="text-app-muted">{t("jobs.detail.employment")}</dt>
            <dd className="text-app-fg">
              {t(`jobs.filters.values.employment.${state.job.employmentType}`, {
                defaultValue: notStated,
              })}
            </dd>
            <dt className="text-app-muted">{t("jobs.detail.seniority")}</dt>
            <dd className="text-app-fg">
              {t(`jobs.filters.values.seniority.${state.job.seniority}`, {
                defaultValue: notStated,
              })}
            </dd>
            <dt className="text-app-muted">{t("jobs.detail.visa")}</dt>
            <dd className="text-app-fg">{t(`jobs.filters.visa.${state.job.visaSponsorship}`)}</dd>
            <dt className="text-app-muted">{t("jobs.detail.language")}</dt>
            <dd className="text-app-fg">{state.job.language ?? notStated}</dd>
            <dt className="text-app-muted">{t("jobs.detail.salary")}</dt>
            <dd className="text-app-fg">{salaryText}</dd>
          </dl>

          {state.job.score === null ? (
            <p className="text-sm font-medium text-app-fg">{t("jobs.results.notScored")}</p>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-app-fg">
                {t("jobs.results.affinity", { score: state.job.score })}
              </p>
              {state.job.explanation ? (
                <p className="text-sm text-app-muted">{state.job.explanation}</p>
              ) : null}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-medium text-app-fg">{t("jobs.detail.description")}</h4>
            <p className="whitespace-pre-line text-sm text-app-fg">
              {state.job.description === ""
                ? t("jobs.detail.noDescription")
                : state.job.description}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-medium text-app-fg">{t("jobs.detail.sources")}</h4>
            {state.job.sources.length === 0 ? (
              <p className="text-sm text-app-muted">{t("jobs.detail.noSources")}</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {state.job.sources.map((source) => (
                  <li key={`${source.source}-${source.url}`} className="flex flex-col gap-0.5">
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
}

/**
 * Starts preparing the job. A duplicate warning shows the earlier applications and asks for one
 * confirmation (same company) or two (same job or fingerprint).
 */
function PreparePanel({ prepare, onPrepare, onConfirm, onCancel, formatDate }: PreparePanelProps) {
  const { t } = useTranslation();
  if (prepare.status === "warning") {
    const { duplicates, confirmed } = prepare;
    const earlier = duplicates.sameJob.length > 0 ? duplicates.sameJob : duplicates.sameCompany;
    const warning =
      duplicates.sameJob.length > 0
        ? "jobs.detail.prepareCheck.sameJobWarning"
        : "jobs.detail.prepareCheck.sameCompanyWarning";
    return (
      <div role="alert" className="flex flex-col gap-3 rounded-md border border-app-border p-4">
        <p className="text-sm font-medium text-app-fg">{t(warning, { count: earlier.length })}</p>
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
          <Button onClick={onConfirm}>
            {t(
              confirmed === 0
                ? "jobs.detail.prepareCheck.confirmOnce"
                : "jobs.detail.prepareCheck.confirmAgain",
            )}
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            {t("jobs.detail.prepareCheck.cancel")}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button onClick={onPrepare} disabled={prepare.status === "busy"}>
          {t("jobs.detail.prepare")}
        </Button>
      </div>
      {prepare.status === "done" ? (
        <p role="status" className="text-sm text-app-fg">
          {t("jobs.detail.prepared", {
            status: t(`applications.status.${prepare.applicationStatus}`),
          })}
        </p>
      ) : null}
      {prepare.status === "failed" ? (
        <p role="alert" className="text-sm text-app-fg">
          {t("jobs.detail.prepareCheck.failed")}
        </p>
      ) : null}
    </div>
  );
}
