import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  DEFAULT_JOB_FILTER,
  isCloudAiEndpoint,
  JobFilterSchema,
  type CompanyRecord,
  type IngestEvent,
  type IngestStartFailureCode,
  type JobFilter,
  type JobListItem,
  type JobSort,
  type LatestRun,
  type SavedSearch,
  type ScoreStartResult,
} from "@job-finder/bridge";
import { useBridge } from "../../lib/bridge/BridgeContext";
import { Button } from "../../components/ui/Button";
import { CheckboxInput } from "../../components/ui/CheckboxInput";
import { JobDetail } from "./JobDetail";
import { JobFilters } from "./JobFilters";
import { SavedSearches, type SavedSearchesState } from "./SavedSearches";
import { draftFromFilter, EMPTY_DRAFT, filterFromDraft, type FilterDraft } from "./filter-draft";

interface Lists {
  companies: CompanyRecord[];
  jobs: JobListItem[];
}

type LoadState = { status: "loading" } | { status: "error" } | ({ status: "ready" } & Lists);

const SORTS: readonly JobSort[] = ["affinity", "newest"];

function isDefaultFilter(filter: JobFilter): boolean {
  return JSON.stringify(filter) === JSON.stringify(DEFAULT_JOB_FILTER);
}

/**
 * The ingestion run, the affinity scores and the results with their filters. Companies are managed
 * on their own screen. Progress arrives from the engine through the bridge; the log shows the events
 * of the latest run, and a finished run reloads the lists.
 */
export function JobsScreen() {
  const { t } = useTranslation();
  const bridge = useBridge();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [events, setEvents] = useState<IngestEvent[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [startFailure, setStartFailure] = useState<IngestStartFailureCode | null>(null);
  const [starting, setStarting] = useState(false);
  const [cloud, setCloud] = useState(false);
  const [providerName, setProviderName] = useState("");
  const [consent, setConsent] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [scoreResult, setScoreResult] = useState<ScoreStartResult | null>(null);

  // The form's draft, and the filter and order the results show.
  const [draft, setDraft] = useState<FilterDraft>(EMPTY_DRAFT);
  const [filterInvalid, setFilterInvalid] = useState(false);
  const [applied, setApplied] = useState<JobFilter>(DEFAULT_JOB_FILTER);
  const [sort, setSort] = useState<JobSort>("affinity");
  const [refreshing, setRefreshing] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const [saved, setSaved] = useState<SavedSearchesState>({ status: "loading" });
  const [savedFailed, setSavedFailed] = useState(false);

  const readJobs = useCallback(
    (filter: JobFilter, order: JobSort) => bridge.jobs.list({ filter, sort: order }),
    [bridge],
  );

  const readLists = useCallback(
    async (filter: JobFilter, order: JobSort): Promise<Lists> => {
      const [companies, jobs] = await Promise.all([
        bridge.companies.list(),
        readJobs(filter, order),
      ]);
      return { companies, jobs };
    },
    [bridge, readJobs],
  );

  const loadAll = useCallback(async () => {
    try {
      const [lists, latest] = await Promise.all([
        readLists(DEFAULT_JOB_FILTER, "affinity"),
        bridge.ingest.latest(),
      ]);
      return { state: { status: "ready", ...lists } as LoadState, latest };
    } catch {
      return { state: { status: "error" } as LoadState, latest: null as LatestRun | null };
    }
  }, [bridge, readLists]);

  const readSaved = useCallback(async () => {
    try {
      setSaved({ status: "ready", searches: await bridge.savedSearches.list() });
    } catch {
      setSaved({ status: "error" });
    }
  }, [bridge]);

  useEffect(() => {
    let active = true;
    void bridge.settings
      .get()
      .then((settings) => {
        if (!active) return;
        setCloud(isCloudAiEndpoint(settings.ai));
        setProviderName(t(`settings.ai.providers.${settings.ai.provider}`));
      })
      .catch(() => {});
    void loadAll().then(({ state, latest }) => {
      if (!active) return;
      void readSaved();
      setLoad(state);
      setEvents(latest?.events ?? []);
      setActiveRunId(latest?.run.status === "running" ? latest.run.id : null);
    });
    return () => {
      active = false;
    };
  }, [bridge, loadAll, readSaved, t]);

  useEffect(
    () =>
      bridge.ingest.onProgress((event) => {
        setEvents((previous) => (event.kind === "run-started" ? [event] : [...previous, event]));
        if (event.kind === "run-started") {
          setActiveRunId(event.runId);
        }
        if (event.kind === "run-finished") {
          setActiveRunId(null);
          void readLists(applied, sort).then(
            (lists) => setLoad({ status: "ready", ...lists }),
            () => setLoad({ status: "error" }),
          );
        }
      }),
    [bridge, readLists, applied, sort],
  );

  function retry() {
    setLoad({ status: "loading" });
    void loadAll().then(({ state, latest }) => {
      setLoad(state);
      setEvents(latest?.events ?? []);
      setActiveRunId(latest?.run.status === "running" ? latest.run.id : null);
    });
    void readSaved();
  }

  /** Reloads the job list for a filter and order, keeping the companies already read. */
  async function refreshJobs(filter: JobFilter, order: JobSort) {
    setRefreshing(true);
    try {
      const jobs = await readJobs(filter, order);
      setLoad((previous) => (previous.status === "ready" ? { ...previous, jobs } : previous));
    } catch {
      setLoad({ status: "error" });
    } finally {
      setRefreshing(false);
    }
  }

  function applyDraft() {
    const result = filterFromDraft(draft);
    setFilterInvalid(!result.ok);
    if (!result.ok) return;
    setApplied(result.filter);
    void refreshJobs(result.filter, sort);
  }

  function resetFilters() {
    setDraft(EMPTY_DRAFT);
    setFilterInvalid(false);
    setApplied(DEFAULT_JOB_FILTER);
    void refreshJobs(DEFAULT_JOB_FILTER, sort);
  }

  function changeSort(next: JobSort) {
    setSort(next);
    void refreshJobs(applied, next);
  }

  function applySaved(search: SavedSearch) {
    const filter = JobFilterSchema.parse(search.filter);
    setDraft(draftFromFilter(filter));
    setFilterInvalid(false);
    setApplied(filter);
    void refreshJobs(filter, sort);
  }

  /** Stores the filters the results show, as a new search or in place of an existing one. */
  async function storeSearch(name: string, id?: string) {
    setSavedFailed(false);
    try {
      const stored = await bridge.savedSearches.save({ id, name, filter: applied });
      if (stored === null) throw new Error("unknown search");
      const current = await bridge.savedSearches.list();
      setSaved({ status: "ready", searches: current });
    } catch {
      setSavedFailed(true);
    }
  }

  async function deleteSearch(search: SavedSearch) {
    setSavedFailed(false);
    try {
      await bridge.savedSearches.delete({ id: search.id });
      setSaved((previous) =>
        previous.status === "ready"
          ? { status: "ready", searches: previous.searches.filter((item) => item.id !== search.id) }
          : previous,
      );
    } catch {
      setSavedFailed(true);
    }
  }

  function jobsChanged() {
    void refreshJobs(applied, sort);
  }

  async function startScan() {
    setStarting(true);
    setStartFailure(null);
    try {
      const result = await bridge.ingest.start();
      if (result.ok) {
        setActiveRunId(result.runId);
      } else {
        setStartFailure(result.code);
      }
    } catch {
      setStartFailure("engine-unavailable");
    } finally {
      setStarting(false);
    }
  }

  /**
   * Scores the jobs that pass the hard filters of the results, the listed ones first. The lists reload
   * afterwards, since a partial run still stores scores.
   */
  async function scoreJobs() {
    setScoring(true);
    setScoreResult(null);
    const visibleJobIds = load.status === "ready" ? load.jobs.map((job) => job.id) : [];
    try {
      setScoreResult(await bridge.scores.start({ consent, filter: applied, visibleJobIds }));
    } catch {
      setScoreResult({ ok: false, code: "engine-unavailable" });
    }
    try {
      const lists = await readLists(applied, sort);
      setLoad({ status: "ready", ...lists });
    } catch {
      setLoad({ status: "error" });
    } finally {
      setScoring(false);
    }
  }

  function cancelScan() {
    if (activeRunId === null) return;
    bridge.ingest.cancel(activeRunId).catch(() => {});
  }

  function describeEvent(event: IngestEvent): string {
    switch (event.kind) {
      case "run-started":
        return t("jobs.log.runStarted");
      case "company-started":
        return t("jobs.log.companyStarted", { company: event.companyName });
      case "company-scanned":
        return t("jobs.log.companyScanned", {
          company: event.companyName,
          postings: event.jobCount,
          closed: event.closedCount,
        });
      case "company-failed":
        return t("jobs.log.companyFailed", {
          company: event.companyName,
          reason: t(`jobs.log.reasons.${event.code}`, {
            defaultValue: t("jobs.log.reasons.unknown"),
          }),
        });
      case "run-finished":
        return t("jobs.log.runFinished", {
          status: t(`jobs.log.statuses.${event.status}`, { defaultValue: event.status }),
        });
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 p-8">
      <nav>
        <Link to="/" className="text-sm text-app-accent underline">
          {t("jobs.backHome")}
        </Link>
      </nav>
      <h1 className="text-3xl font-semibold text-app-fg">{t("jobs.title")}</h1>
      <p className="flex flex-wrap gap-4">
        <Link to="/companies" className="text-sm text-app-accent underline">
          {t("jobs.openCompanies")}
        </Link>
        <Link to="/applications" className="text-sm text-app-accent underline">
          {t("jobs.openApplications")}
        </Link>
      </p>

      {load.status === "loading" ? (
        <p role="status" className="text-app-muted">
          {t("jobs.loading")}
        </p>
      ) : null}

      {load.status === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-app-fg">{t("jobs.loadFailed")}</p>
          <Button variant="secondary" onClick={retry}>
            {t("jobs.retry")}
          </Button>
        </div>
      ) : null}

      {load.status === "ready" ? (
        <>
          <section aria-labelledby="jobs-scan-title" className="flex flex-col gap-4">
            <h2 id="jobs-scan-title" className="text-xl font-medium text-app-fg">
              {t("jobs.scan.heading")}
            </h2>
            <div>
              {activeRunId === null ? (
                <Button
                  onClick={() => void startScan()}
                  disabled={starting || load.companies.length === 0}
                >
                  {starting ? t("jobs.scan.starting") : t("jobs.scan.start")}
                </Button>
              ) : (
                <Button variant="secondary" onClick={cancelScan}>
                  {t("jobs.scan.cancel")}
                </Button>
              )}
            </div>
            {load.companies.length === 0 ? (
              <p className="text-sm text-app-muted">{t("jobs.scan.needCompanies")}</p>
            ) : null}
            <p role="status" className="text-sm text-app-muted">
              {activeRunId === null ? t("jobs.scan.idle") : t("jobs.scan.running")}
            </p>
            {startFailure ? (
              <p role="alert" className="text-sm text-app-fg">
                {t(
                  startFailure === "already-running"
                    ? "jobs.scan.alreadyRunning"
                    : "jobs.scan.engineUnavailable",
                )}
              </p>
            ) : null}
            <h3 id="jobs-log-title" className="text-base font-medium text-app-fg">
              {t("jobs.log.heading")}
            </h3>
            {events.length === 0 ? (
              <p className="text-sm text-app-muted">{t("jobs.log.empty")}</p>
            ) : (
              <ol
                aria-labelledby="jobs-log-title"
                aria-live="polite"
                className="flex flex-col gap-1 text-sm text-app-fg"
              >
                {events.map((event) => (
                  <li key={`${event.runId}-${event.seq}`}>{describeEvent(event)}</li>
                ))}
              </ol>
            )}
          </section>

          <section aria-labelledby="jobs-score-title" className="flex flex-col gap-4">
            <h2 id="jobs-score-title" className="text-xl font-medium text-app-fg">
              {t("jobs.score.heading")}
            </h2>
            <p className="text-sm text-app-muted">{t("jobs.score.intro")}</p>
            {cloud ? (
              <div className="flex flex-col gap-3 rounded-lg border border-app-border p-4">
                <p className="text-sm text-app-fg">
                  {t("jobs.score.consentNote", { provider: providerName })}
                </p>
                <CheckboxInput
                  label={t("jobs.score.consent", { provider: providerName })}
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
              </div>
            ) : null}
            <div>
              <Button onClick={() => void scoreJobs()} disabled={scoring || load.jobs.length === 0}>
                {t("jobs.score.start")}
              </Button>
            </div>
            {load.jobs.length === 0 ? (
              <p className="text-sm text-app-muted">{t("jobs.score.needJobs")}</p>
            ) : null}
            {scoring ? (
              <p role="status" className="text-sm text-app-muted">
                {t("jobs.score.running")}
              </p>
            ) : null}
            {scoreResult?.ok === true ? (
              <p role="status" className="text-sm text-app-fg">
                {t("jobs.score.done", {
                  scored: scoreResult.scored,
                  cached: scoreResult.cached,
                  failed: scoreResult.failed,
                  skipped: scoreResult.skipped,
                })}
              </p>
            ) : null}
            {scoreResult?.ok === false ? (
              <div role="alert" className="flex flex-col items-start gap-2">
                <p className="text-sm text-app-fg">
                  {t(`jobs.score.failures.${scoreResult.code}`, {
                    defaultValue: t("jobs.score.failures.unknown"),
                  })}
                </p>
                {scoreResult.code === "ai-unavailable" ? (
                  <Link to="/settings" className="text-sm text-app-accent underline">
                    {t("jobs.score.openSettings")}
                  </Link>
                ) : null}
                {scoreResult.code === "no-profile" ? (
                  <Link to="/profile" className="text-sm text-app-accent underline">
                    {t("jobs.score.openProfile")}
                  </Link>
                ) : null}
              </div>
            ) : null}
          </section>

          <section aria-labelledby="jobs-results-title" className="flex flex-col gap-4">
            <h2 id="jobs-results-title" className="text-xl font-medium text-app-fg">
              {t("jobs.results.heading")}
            </h2>
            <JobFilters
              draft={draft}
              onChange={setDraft}
              companies={load.companies}
              onApply={applyDraft}
              onReset={resetFilters}
              invalid={filterInvalid}
            />
            <SavedSearches
              state={saved}
              saveable={!filterInvalid}
              onApply={applySaved}
              onCreate={(name) => void storeSearch(name)}
              onReplace={(search) => void storeSearch(search.name, search.id)}
              onDelete={(search) => void deleteSearch(search)}
              onRetry={() => void readSaved()}
            />
            {savedFailed ? (
              <p role="alert" className="text-sm text-app-fg">
                {t("jobs.saved.saveFailed")}
              </p>
            ) : null}

            <div role="group" aria-label={t("jobs.sort.label")} className="flex flex-wrap gap-2">
              {SORTS.map((option) => (
                <Button
                  key={option}
                  variant={sort === option ? "primary" : "secondary"}
                  aria-pressed={sort === option}
                  onClick={() => changeSort(option)}
                >
                  {t(`jobs.sort.${option}`)}
                </Button>
              ))}
            </div>

            {selectedJobId !== null ? (
              <JobDetail
                key={selectedJobId}
                jobId={selectedJobId}
                onChanged={jobsChanged}
                onClose={() => setSelectedJobId(null)}
              />
            ) : null}

            {refreshing ? (
              <p role="status" className="text-sm text-app-muted">
                {t("jobs.loading")}
              </p>
            ) : null}
            {load.jobs.length === 0 ? (
              <p className="text-app-muted">
                {t(isDefaultFilter(applied) ? "jobs.results.empty" : "jobs.results.noMatch")}
              </p>
            ) : (
              <ul className="flex flex-col gap-2" aria-label={t("jobs.results.heading")}>
                {load.jobs.map((job) => (
                  <li
                    key={job.id}
                    className="flex flex-col gap-1 rounded-md border border-app-border p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-app-fg">{job.title}</p>
                      {job.isNew ? (
                        <span className="rounded-full bg-app-accent px-2 py-0.5 text-xs text-app-bg">
                          {t("jobs.results.new")}
                        </span>
                      ) : null}
                      {job.dismissed ? (
                        <span className="rounded-full border border-app-border px-2 py-0.5 text-xs text-app-muted">
                          {t("jobs.results.dismissed")}
                        </span>
                      ) : null}
                      {job.applicationStatus !== null ? (
                        <span className="rounded-full border border-app-border px-2 py-0.5 text-xs text-app-fg">
                          {t("jobs.results.applicationStatus", {
                            status: t(`applications.status.${job.applicationStatus}`),
                          })}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm text-app-muted">
                      {job.companyName} ·{" "}
                      {job.locations.length > 0
                        ? job.locations.join(" / ")
                        : t("jobs.results.noLocation")}{" "}
                      · {t(`jobs.results.workMode.${job.workMode}`)}
                    </p>
                    <p className="text-sm font-medium text-app-fg">
                      {job.score === null
                        ? t("jobs.results.notScored")
                        : t("jobs.results.affinity", { score: job.score })}
                    </p>
                    {job.explanation ? (
                      <p className="text-sm text-app-muted">{job.explanation}</p>
                    ) : null}
                    <div>
                      <Button
                        variant="secondary"
                        aria-label={t("jobs.results.openJob", { title: job.title })}
                        onClick={() => setSelectedJobId(job.id)}
                      >
                        {t("jobs.results.open")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
