import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { JobDetail as JobDetailRecord } from "@job-finder/bridge";
import { useBridge } from "../../lib/bridge/BridgeContext";
import { Button } from "../../components/ui/Button";

type DetailState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "missing" }
  | { status: "ready"; job: JobDetailRecord };

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
  const { t } = useTranslation();
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
          </div>

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
