import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import {
  DEFAULT_JOB_FILTER,
  aiConsentTarget,
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
  type ProfileDiscoveryResult,
} from "@job-finder/bridge";
import { useBridge } from "../../lib/bridge/BridgeContext";
import { Briefcase, Building2, RefreshCw, SlidersHorizontal, Sparkles } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Drawer } from "../../components/ui/Drawer";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { ScoreRing } from "../../components/ui/ScoreRing";
import { CheckboxInput } from "../../components/ui/CheckboxInput";
import { JobDetail } from "./JobDetail";
import { useAiConsent } from "../../lib/useAiConsent";
import { JobFilters } from "./JobFilters";
import { SavedSearches, type SavedSearchesState } from "./SavedSearches";
import { draftFromFilter, EMPTY_DRAFT, filterFromDraft, type FilterDraft } from "./filter-draft";
import { filterFromPreferences } from "./preferences-filter";

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
  const [aiTarget, setAiTarget] = useState<string | null>(null);
  const { consent, consentTarget, setConsent } = useAiConsent(aiTarget);
  const [scoring, setScoring] = useState(false);
  const [scoreResult, setScoreResult] = useState<ScoreStartResult | null>(null);

  // The form's draft, and the filter and order the results show.
  const [draft, setDraft] = useState<FilterDraft>(EMPTY_DRAFT);
  const [filterInvalid, setFilterInvalid] = useState(false);
  const [applied, setApplied] = useState<JobFilter>(DEFAULT_JOB_FILTER);
  // The filter from the profile's "what you are looking for": the list opens with it, Reset returns to it.
  const [baseFilter, setBaseFilter] = useState<JobFilter>(DEFAULT_JOB_FILTER);
  const [hasRoles, setHasRoles] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discovery, setDiscovery] = useState<ProfileDiscoveryResult | null>(null);
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
      const profile = await bridge.profile.get().catch(() => null);
      const preferences = profile?.profile.preferences ?? null;
      const base = filterFromPreferences(preferences);
      const [lists, latest] = await Promise.all([
        readLists(base, "affinity"),
        bridge.ingest.latest(),
      ]);
      return {
        state: { status: "ready", ...lists } as LoadState,
        latest,
        base,
        hasRoles: (preferences?.roles.length ?? 0) > 0,
      };
    } catch {
      return {
        state: { status: "error" } as LoadState,
        latest: null as LatestRun | null,
        base: DEFAULT_JOB_FILTER,
        hasRoles: false,
      };
    }
  }, [bridge, readLists]);

  /** Opens the list with the profile's filter, as loaded. */
  function applyBase(base: JobFilter, roles: boolean) {
    setBaseFilter(base);
    setApplied(base);
    setDraft(draftFromFilter(base));
    setHasRoles(roles);
  }

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
        setAiTarget(aiConsentTarget(settings.ai));
        setProviderName(t(`settings.ai.providers.${settings.ai.provider}`));
      })
      .catch(() => {});
    void loadAll().then(({ state, latest, base, hasRoles: roles }) => {
      if (!active) return;
      void readSaved();
      applyBase(base, roles);
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

  // A notification opens `?new=1` (new jobs only) and optionally `saved=<id>` (that saved search).
  // The link is cleared once applied, so the filter is set once per click. The apply step reads the
  // current state through a ref, so the effect runs only when the link or the load state changes.
  const [params, setParams] = useSearchParams();
  const wantsNew = params.get("new") === "1";
  // Profile setup ends on `?discover=1`: the first company search starts by itself, once.
  const wantsDiscover = params.get("discover") === "1";
  const discoverOnce = useRef<() => void>(() => {});
  useEffect(() => {
    discoverOnce.current = () => {
      setParams({}, { replace: true });
      void discoverFromProfile();
    };
  });
  useEffect(() => {
    if (wantsDiscover && load.status === "ready") discoverOnce.current();
  }, [wantsDiscover, load.status]);
  const wantedSaved = params.get("saved");
  const applyLink = useRef<() => void>(() => {});
  useEffect(() => {
    applyLink.current = () => {
      const search =
        wantedSaved === null
          ? undefined
          : saved.status === "ready"
            ? saved.searches.find((item) => item.id === wantedSaved)
            : undefined;
      const base = search ? JobFilterSchema.parse(search.filter) : applied;
      const filter: JobFilter = wantsNew ? { ...base, newOnly: true } : base;
      setParams({}, { replace: true });
      setDraft(draftFromFilter(filter));
      setFilterInvalid(false);
      setApplied(filter);
      void readJobs(filter, sort).then(
        (jobs) =>
          setLoad((previous) => (previous.status === "ready" ? { ...previous, jobs } : previous)),
        () => setLoad({ status: "error" }),
      );
    };
  });
  useEffect(() => {
    if (!wantsNew && wantedSaved === null) return;
    if (load.status !== "ready" || saved.status !== "ready") return;
    applyLink.current();
  }, [load.status, saved.status, wantsNew, wantedSaved]);

  function retry() {
    setLoad({ status: "loading" });
    void loadAll().then(({ state, latest, base, hasRoles: roles }) => {
      applyBase(base, roles);
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
    setDraft(draftFromFilter(baseFilter));
    setFilterInvalid(false);
    setApplied(baseFilter);
    void refreshJobs(baseFilter, sort);
  }

  /** Finds and adds the companies the profile points to; the scan that follows shows in the log. */
  async function discoverFromProfile() {
    setDiscovering(true);
    setDiscovery(null);
    try {
      const result = await bridge.discovery.fromProfile();
      setDiscovery(result);
      if (result.ok && result.added > 0) {
        const companies = await bridge.companies.list();
        setLoad((previous) =>
          previous.status === "ready" ? { ...previous, companies } : previous,
        );
      }
    } catch {
      setDiscovery({ ok: false, code: "engine-unavailable" });
    } finally {
      setDiscovering(false);
    }
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
      setScoreResult(
        await bridge.scores.start({ consent, consentTarget, filter: applied, visibleJobIds }),
      );
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

  const newCount = load.status === "ready" ? load.jobs.filter((job) => job.isNew).length : 0;

  return (
    <main className="flex flex-col gap-8">
      <PageHeader
        title={t("jobs.title")}
        description={
          load.status === "ready"
            ? t("jobs.subtitle", { count: load.jobs.length, fresh: newCount })
            : undefined
        }
        actions={
          load.status === "ready" ? (
            <>
              <Button
                variant="secondary"
                onClick={() => void scoreJobs()}
                disabled={scoring || load.jobs.length === 0}
              >
                <Sparkles aria-hidden="true" className="size-4" strokeWidth={1.8} />
                {t("jobs.score.start")}
              </Button>
              {activeRunId === null ? (
                <Button
                  onClick={() => void startScan()}
                  disabled={starting || load.companies.length === 0}
                >
                  <RefreshCw aria-hidden="true" className="size-4" strokeWidth={1.8} />
                  {starting ? t("jobs.scan.starting") : t("jobs.scan.start")}
                </Button>
              ) : (
                <Button variant="secondary" onClick={cancelScan}>
                  {t("jobs.scan.cancel")}
                </Button>
              )}
            </>
          ) : null
        }
      />

      {load.status === "loading" ? (
        <p role="status" className="text-app-muted">
          {t("jobs.loading")}
        </p>
      ) : null}

      {load.status === "error" ? (
        <EmptyState
          role="alert"
          title={t("jobs.loadFailed")}
          action={
            <Button variant="secondary" onClick={retry}>
              {t("jobs.retry")}
            </Button>
          }
        />
      ) : null}

      {load.status === "ready" ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card as="section" aria-labelledby="jobs-scan-title" className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className={`size-2.5 rounded-full ${
                    activeRunId === null ? "bg-app-subtle" : "animate-pulse bg-app-accent"
                  }`}
                />
                <h2 id="jobs-scan-title" className="font-sans text-base font-semibold">
                  {t("jobs.scan.heading")}
                </h2>
                <p role="status" className="ml-auto text-[13px] text-app-muted">
                  {activeRunId === null ? t("jobs.scan.idle") : t("jobs.scan.running")}
                </p>
              </div>
              <div className="flex flex-col gap-2 rounded-lg bg-app-sunken p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Building2
                    aria-hidden="true"
                    className="size-4 text-app-accent"
                    strokeWidth={1.8}
                  />
                  <p className="flex-1 text-[13px] text-app-fg">
                    {t("jobs.discover.companies", { count: load.companies.length })}
                  </p>
                  {hasRoles ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void discoverFromProfile()}
                      disabled={discovering}
                    >
                      {discovering ? t("jobs.discover.searching") : t("jobs.discover.start")}
                    </Button>
                  ) : null}
                </div>
                {hasRoles ? null : (
                  <p className="text-[13px] text-app-muted">
                    {t("jobs.discover.needRoles")}{" "}
                    <Link to="/profile" className="text-app-accent underline">
                      {t("jobs.discover.openProfile")}
                    </Link>
                  </p>
                )}
                {discovering ? (
                  <p role="status" className="text-[13px] text-app-muted">
                    {t("jobs.discover.searchingLong")}
                  </p>
                ) : null}
                {discovery ? <DiscoveryOutcome result={discovery} /> : null}
                <Link to="/companies" className="text-[13px] text-app-accent underline">
                  {t("jobs.discover.manage")}
                </Link>
              </div>
              {startFailure ? (
                <p role="alert" className="text-[13px] text-app-danger">
                  {t(
                    startFailure === "already-running"
                      ? "jobs.scan.alreadyRunning"
                      : "jobs.scan.engineUnavailable",
                  )}
                </p>
              ) : null}
              <details className="group" open={events.length > 0 && activeRunId !== null}>
                <summary
                  id="jobs-log-title"
                  className="cursor-pointer text-[13px] text-app-muted select-none hover:text-app-fg"
                >
                  {t("jobs.log.heading")}
                </summary>
                {events.length === 0 ? (
                  <p className="mt-2 text-[13px] text-app-muted">{t("jobs.log.empty")}</p>
                ) : (
                  <ol
                    aria-labelledby="jobs-log-title"
                    aria-live="polite"
                    className="mt-2 flex max-h-48 flex-col gap-1 overflow-auto rounded-lg bg-app-sunken p-3 font-mono text-xs text-app-fg"
                  >
                    {events.map((event) => (
                      <li key={`${event.runId}-${event.seq}`}>{describeEvent(event)}</li>
                    ))}
                  </ol>
                )}
              </details>
            </Card>

            <Card as="section" aria-labelledby="jobs-score-title" className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Sparkles aria-hidden="true" className="size-4 text-app-accent" strokeWidth={1.8} />
                <h2 id="jobs-score-title" className="font-sans text-base font-semibold">
                  {t("jobs.score.heading")}
                </h2>
              </div>
              <p className="text-[13px] text-app-muted">{t("jobs.score.intro")}</p>
              {cloud ? (
                <div className="flex flex-col gap-2 rounded-lg bg-app-sunken p-3">
                  <p className="text-[13px] text-app-fg">
                    {t("jobs.score.consentNote", { provider: providerName })}
                  </p>
                  <CheckboxInput
                    label={t("jobs.score.consent", { provider: providerName })}
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                  />
                </div>
              ) : null}
              {load.jobs.length === 0 ? (
                <p className="text-[13px] text-app-muted">{t("jobs.score.needJobs")}</p>
              ) : null}
              {scoring ? (
                <p role="status" className="text-[13px] text-app-muted">
                  {t("jobs.score.running")}
                </p>
              ) : null}
              {scoreResult?.ok === true ? (
                <p role="status" className="text-[13px] text-app-good">
                  {t("jobs.score.done", {
                    scored: scoreResult.scored,
                    cached: scoreResult.cached,
                    failed: scoreResult.failed,
                    skipped: scoreResult.skipped,
                  })}
                </p>
              ) : null}
              {scoreResult?.ok === false ? (
                <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p className="text-[13px] text-app-danger">
                    {t(`jobs.score.failures.${scoreResult.code}`, {
                      defaultValue: t("jobs.score.failures.unknown"),
                    })}
                  </p>
                  {scoreResult.code === "ai-unavailable" ? (
                    <Link to="/settings" className="text-[13px] text-app-accent underline">
                      {t("jobs.score.openSettings")}
                    </Link>
                  ) : null}
                  {scoreResult.code === "no-profile" ? (
                    <Link to="/profile" className="text-[13px] text-app-accent underline">
                      {t("jobs.score.openProfile")}
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </Card>
          </div>

          <section aria-labelledby="jobs-results-title" className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="jobs-results-title" className="sr-only">
                {t("jobs.results.heading")}
              </h2>
              <div role="group" aria-label={t("jobs.sort.label")} className="flex flex-wrap gap-2">
                {SORTS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={sort === option}
                    onClick={() => changeSort(option)}
                    className={`rounded-full px-3.5 py-1.5 text-[13px] transition-colors ${
                      sort === option
                        ? "bg-app-accent text-app-accent-fg"
                        : "bg-app-sunken text-app-muted hover:text-app-fg"
                    }`}
                  >
                    {t(`jobs.sort.${option}`)}
                  </button>
                ))}
              </div>
              <span className="flex-1" />
              {refreshing ? (
                <p role="status" className="text-[13px] text-app-muted">
                  {t("jobs.loading")}
                </p>
              ) : null}
            </div>

            <details className="rounded-2xl border border-app-border bg-app-surface shadow-card">
              <summary className="flex cursor-pointer items-center gap-2 px-5 py-3 text-sm font-medium select-none">
                <SlidersHorizontal aria-hidden="true" className="size-4" strokeWidth={1.8} />
                {t("jobs.filtersToggle")}
              </summary>
              <div className="flex flex-col gap-4 border-t border-app-border p-5">
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
              </div>
            </details>
            {savedFailed ? (
              <p role="alert" className="text-sm text-app-danger">
                {t("jobs.saved.saveFailed")}
              </p>
            ) : null}

            {load.jobs.length === 0 ? (
              <EmptyState
                icon={<Briefcase aria-hidden="true" className="size-5" strokeWidth={1.8} />}
                title={t(isDefaultFilter(applied) ? "jobs.results.empty" : "jobs.results.noMatch")}
              />
            ) : (
              <ul
                className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]"
                aria-label={t("jobs.results.heading")}
              >
                {load.jobs.map((job) => (
                  <JobCard key={job.id} job={job} onOpen={() => setSelectedJobId(job.id)} />
                ))}
              </ul>
            )}
          </section>

          {selectedJobId !== null ? (
            <Drawer label={t("jobs.detail.heading")} onClose={() => setSelectedJobId(null)}>
              <JobDetail
                key={selectedJobId}
                jobId={selectedJobId}
                onChanged={jobsChanged}
                onClose={() => setSelectedJobId(null)}
              />
            </Drawer>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

function JobCard({ job, onOpen }: { job: JobListItem; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <Card as="li" className={`flex flex-col gap-3 ${job.dismissed ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3.5">
        <ScoreRing
          score={job.score}
          label={
            job.score === null
              ? t("jobs.results.notScored")
              : t("jobs.results.affinity", { score: job.score })
          }
        />
        <div className="min-w-0">
          <p className="text-[17px] leading-snug font-semibold text-app-fg">{job.title}</p>
          <p className="mt-0.5 truncate text-[13px] text-app-muted">
            {job.companyName} ·{" "}
            {job.locations.length > 0 ? job.locations.join(" / ") : t("jobs.results.noLocation")}
          </p>
        </div>
      </div>
      {job.explanation ? (
        <p className="line-clamp-3 border-l-[3px] border-app-accent-soft pl-2.5 text-[13px] text-app-muted">
          {job.explanation}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        <Badge>{t(`jobs.results.workMode.${job.workMode}`)}</Badge>
        {job.isNew ? <Badge tone="accent">{t("jobs.results.new")}</Badge> : null}
        {job.dismissed ? <Badge>{t("jobs.results.dismissed")}</Badge> : null}
        {job.applicationStatus !== null ? (
          <Badge tone="good">
            {t("jobs.results.applicationStatus", {
              status: t(`applications.status.${job.applicationStatus}`),
            })}
          </Badge>
        ) : null}
      </div>
      <div className="mt-auto flex items-center justify-end border-t border-dashed border-app-border pt-3">
        <Button
          size="sm"
          aria-label={t("jobs.results.openJob", { title: job.title })}
          onClick={onOpen}
        >
          {t("jobs.results.open")}
        </Button>
      </div>
    </Card>
  );
}

/** What the company search from the profile did, or why it could not. */
function DiscoveryOutcome({ result }: { result: ProfileDiscoveryResult }) {
  const { t } = useTranslation();
  if (!result.ok) {
    return (
      <p role="alert" className="text-[13px] text-app-danger">
        {t(`jobs.discover.failure.${result.code}`)}
      </p>
    );
  }
  return (
    <p role="status" className="text-[13px] text-app-fg">
      {result.added > 0
        ? t("jobs.discover.added", { count: result.added, found: result.found })
        : result.found > 0
          ? t("jobs.discover.nothingNew", { count: result.found })
          : t("jobs.discover.none")}
      {result.runStarted ? ` ${t("jobs.discover.scanning")}` : ""}
      {result.searchBlocked ? ` ${t("jobs.discover.blocked")}` : ""}
    </p>
  );
}
