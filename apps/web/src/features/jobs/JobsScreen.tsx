import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type {
  CompanyAddFailureCode,
  CompanyRecord,
  IngestEvent,
  IngestStartFailureCode,
  JobListItem,
  LatestRun,
} from "@job-finder/bridge";
import { useBridge } from "../../lib/bridge/BridgeContext";
import { Button } from "../../components/ui/Button";
import { TextInput } from "../../components/ui/TextInput";

interface Lists {
  companies: CompanyRecord[];
  jobs: JobListItem[];
}

type LoadState = { status: "loading" } | { status: "error" } | ({ status: "ready" } & Lists);

/**
 * Companies, the ingestion run and the results. Progress arrives from the engine through the
 * bridge; the log shows the events of the latest run, and a finished run reloads the lists.
 */
export function JobsScreen() {
  const { t } = useTranslation();
  const bridge = useBridge();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [events, setEvents] = useState<IngestEvent[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [startFailure, setStartFailure] = useState<IngestStartFailureCode | null>(null);
  const [starting, setStarting] = useState(false);
  const [name, setName] = useState("");
  const [careersUrl, setCareersUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [addFailure, setAddFailure] = useState<CompanyAddFailureCode | "unknown" | null>(null);

  const readLists = useCallback(async (): Promise<Lists> => {
    const [companies, jobs] = await Promise.all([bridge.companies.list(), bridge.jobs.list()]);
    return { companies, jobs };
  }, [bridge]);

  const loadAll = useCallback(async () => {
    try {
      const [lists, latest] = await Promise.all([readLists(), bridge.ingest.latest()]);
      return { state: { status: "ready", ...lists } as LoadState, latest };
    } catch {
      return { state: { status: "error" } as LoadState, latest: null as LatestRun | null };
    }
  }, [bridge, readLists]);

  useEffect(() => {
    let active = true;
    void loadAll().then(({ state, latest }) => {
      if (!active) return;
      setLoad(state);
      setEvents(latest?.events ?? []);
      setActiveRunId(latest?.run.status === "running" ? latest.run.id : null);
    });
    return () => {
      active = false;
    };
  }, [loadAll]);

  useEffect(
    () =>
      bridge.ingest.onProgress((event) => {
        setEvents((previous) => (event.kind === "run-started" ? [event] : [...previous, event]));
        if (event.kind === "run-started") {
          setActiveRunId(event.runId);
        }
        if (event.kind === "run-finished") {
          setActiveRunId(null);
          void readLists().then(
            (lists) => setLoad({ status: "ready", ...lists }),
            () => setLoad({ status: "error" }),
          );
        }
      }),
    [bridge, readLists],
  );

  function retry() {
    setLoad({ status: "loading" });
    void loadAll().then(({ state, latest }) => {
      setLoad(state);
      setEvents(latest?.events ?? []);
      setActiveRunId(latest?.run.status === "running" ? latest.run.id : null);
    });
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

  function cancelScan() {
    if (activeRunId === null) return;
    bridge.ingest.cancel(activeRunId).catch(() => {});
  }

  async function addCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdding(true);
    setAdded(false);
    setAddFailure(null);
    try {
      const result = await bridge.companies.add({ name, careersUrl });
      if (result.ok) {
        setLoad((previous) =>
          previous.status === "ready"
            ? { ...previous, companies: [...previous.companies, result.company] }
            : previous,
        );
        setName("");
        setCareersUrl("");
        setAdded(true);
      } else {
        setAddFailure(result.code);
      }
    } catch {
      setAddFailure("unknown");
    } finally {
      setAdding(false);
    }
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
          <section aria-labelledby="jobs-companies-title" className="flex flex-col gap-4">
            <h2 id="jobs-companies-title" className="text-xl font-medium text-app-fg">
              {t("jobs.companies.heading")}
            </h2>
            {load.companies.length === 0 ? (
              <p className="text-app-muted">{t("jobs.companies.empty")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {load.companies.map((company) => (
                  <li key={company.id} className="rounded-md border border-app-border p-3">
                    <p className="font-medium text-app-fg">{company.name}</p>
                    <p className="text-sm text-app-muted">
                      {company.ats
                        ? t("jobs.companies.board", { ats: company.ats })
                        : t("jobs.companies.noBoard")}
                    </p>
                    <p className="break-all text-xs text-app-muted">{company.careersUrl}</p>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={addCompany} className="flex flex-col gap-3">
              <TextInput
                label={t("jobs.companies.name")}
                value={name}
                maxLength={200}
                required
                onChange={(event) => setName(event.target.value)}
              />
              <TextInput
                label={t("jobs.companies.careersUrl")}
                hint={t("jobs.companies.careersUrlHint")}
                type="url"
                value={careersUrl}
                required
                onChange={(event) => setCareersUrl(event.target.value)}
              />
              {addFailure ? (
                <p role="alert" className="text-sm text-app-fg">
                  {t(`jobs.companies.failure.${addFailure}`)}
                </p>
              ) : null}
              {added ? (
                <p role="status" className="text-sm text-app-muted">
                  {t("jobs.companies.added")}
                </p>
              ) : null}
              <div>
                <Button type="submit" disabled={adding}>
                  {t("jobs.companies.add")}
                </Button>
              </div>
            </form>
          </section>

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

          <section aria-labelledby="jobs-results-title" className="flex flex-col gap-4">
            <h2 id="jobs-results-title" className="text-xl font-medium text-app-fg">
              {t("jobs.results.heading")}
            </h2>
            {load.jobs.length === 0 ? (
              <p className="text-app-muted">{t("jobs.results.empty")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {load.jobs.map((job) => (
                  <li key={job.id} className="rounded-md border border-app-border p-4">
                    <p className="font-medium text-app-fg">{job.title}</p>
                    <p className="text-sm text-app-muted">
                      {job.companyName} ·{" "}
                      {job.locations.length > 0
                        ? job.locations.join(" / ")
                        : t("jobs.results.noLocation")}{" "}
                      · {t(`jobs.results.workMode.${job.workMode}`)}
                    </p>
                    <p className="break-all text-xs text-app-muted">
                      {t("jobs.results.applyLink", { url: job.applyUrl })}
                    </p>
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
