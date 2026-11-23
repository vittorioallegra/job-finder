import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  APPLICATION_STATUSES,
  canTransition,
  type ApplicationStatus,
  type ApplicationSummary,
} from "@job-finder/bridge";
import { useBridge } from "../../lib/bridge/BridgeContext";
import { Button } from "../../components/ui/Button";
import { SelectInput, type SelectOption } from "../../components/ui/SelectInput";
import { ApplicationDetail } from "./ApplicationDetail";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; applications: ApplicationSummary[] };

type View = "list" | "board";
const VIEWS: readonly View[] = ["list", "board"];

interface Notice {
  tone: "ok" | "error";
  text: string;
}

/**
 * The tracker: every application as a list or as a board (one column per status), filtered by status
 * and company. A status moves only along the planned steps. The timeline and notes open beside the list.
 */
export function ApplicationsScreen() {
  const { t, i18n } = useTranslation();
  const bridge = useBridge();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [view, setView] = useState<View>("list");
  const [statusFilter, setStatusFilter] = useState<"" | ApplicationStatus>("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  // A retry bumps `attempt`, which reads the list again.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void bridge.applications.list().then(
      (applications) => {
        if (active) setLoad({ status: "ready", applications });
      },
      () => {
        if (active) setLoad({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [bridge, attempt]);

  const companies = useMemo(() => {
    if (load.status !== "ready") return [];
    const byId = new Map<string, string>();
    for (const application of load.applications) {
      byId.set(application.companyId, application.companyName);
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [load]);

  const visible = useMemo(() => {
    if (load.status !== "ready") return [];
    return load.applications.filter(
      (application) =>
        (statusFilter === "" || application.status === statusFilter) &&
        (companyFilter === "" || application.companyId === companyFilter),
    );
  }, [load, statusFilter, companyFilter]);

  function replace(updated: ApplicationSummary) {
    setLoad((previous) =>
      previous.status === "ready"
        ? {
            status: "ready",
            applications: previous.applications.map((item) =>
              item.id === updated.id ? updated : item,
            ),
          }
        : previous,
    );
  }

  async function changeStatus(application: ApplicationSummary, status: ApplicationStatus) {
    setNotice(null);
    try {
      const result = await bridge.applications.update({
        applicationId: application.id,
        status,
      });
      if (!result.ok) {
        setNotice({ tone: "error", text: t("applications.statusFailed") });
        return;
      }
      replace({
        ...application,
        status: result.application.status,
        statusChangedAt: result.application.statusChangedAt,
      });
    } catch {
      setNotice({ tone: "error", text: t("applications.statusFailed") });
    }
  }

  async function exportCsv() {
    setNotice(null);
    try {
      const result = await bridge.applications.exportCsv();
      if (result.ok) {
        setNotice({
          tone: "ok",
          text: t("applications.export.done", { count: result.count, path: result.path }),
        });
      } else if (result.code === "write-failed") {
        setNotice({ tone: "error", text: t("applications.export.failed") });
      }
    } catch {
      setNotice({ tone: "error", text: t("applications.export.failed") });
    }
  }

  /** The statuses a card may move to: its own, plus the ones the status machine allows. */
  function statusOptions(application: ApplicationSummary): SelectOption[] {
    return APPLICATION_STATUSES.filter(
      (status) => status === application.status || canTransition(application.status, status),
    ).map((status) => ({ value: status, label: t(`applications.status.${status}`) }));
  }

  function renderCard(application: ApplicationSummary) {
    const options = statusOptions(application);
    return (
      <li
        key={application.id}
        className="flex flex-col gap-2 rounded-md border border-app-border p-4"
      >
        <p className="font-medium text-app-fg">{application.jobTitle}</p>
        <p className="text-sm text-app-muted">
          {application.companyName} ·{" "}
          {t("applications.changed", {
            date: new Date(application.statusChangedAt).toLocaleDateString(i18n.language),
          })}
        </p>
        <SelectInput
          label={t("applications.cardStatus", { title: application.jobTitle })}
          options={options}
          value={application.status}
          disabled={options.length === 1}
          onChange={(event) =>
            void changeStatus(application, event.target.value as ApplicationStatus)
          }
        />
        <div>
          <Button
            variant="secondary"
            aria-label={t("applications.openDetail", { title: application.jobTitle })}
            onClick={() => setSelectedId(application.id)}
          >
            {t("applications.details")}
          </Button>
        </div>
      </li>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 p-8">
      <nav>
        <Link to="/jobs" className="text-sm text-app-accent underline">
          {t("applications.backToJobs")}
        </Link>
      </nav>
      <h1 className="text-3xl font-semibold text-app-fg">{t("applications.title")}</h1>

      {load.status === "loading" ? (
        <p role="status" className="text-app-muted">
          {t("applications.loading")}
        </p>
      ) : null}

      {load.status === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-app-fg">{t("applications.loadFailed")}</p>
          <Button
            variant="secondary"
            onClick={() => {
              setLoad({ status: "loading" });
              setAttempt((value) => value + 1);
            }}
          >
            {t("applications.retry")}
          </Button>
        </div>
      ) : null}

      {load.status === "ready" ? (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <div role="group" aria-label={t("applications.view.label")} className="flex gap-2">
              {VIEWS.map((option) => (
                <Button
                  key={option}
                  variant={view === option ? "primary" : "secondary"}
                  aria-pressed={view === option}
                  onClick={() => setView(option)}
                >
                  {t(`applications.view.${option}`)}
                </Button>
              ))}
            </div>
            <SelectInput
              label={t("applications.filters.status")}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "" | ApplicationStatus)}
              options={[
                { value: "", label: t("applications.filters.allStatuses") },
                ...APPLICATION_STATUSES.map((status) => ({
                  value: status,
                  label: t(`applications.status.${status}`),
                })),
              ]}
            />
            <SelectInput
              label={t("applications.filters.company")}
              value={companyFilter}
              onChange={(event) => setCompanyFilter(event.target.value)}
              options={[
                { value: "", label: t("applications.filters.allCompanies") },
                ...companies.map(([id, name]) => ({ value: id, label: name })),
              ]}
            />
            <Button variant="secondary" onClick={() => void exportCsv()}>
              {t("applications.export.button")}
            </Button>
          </div>

          {notice ? (
            <p role={notice.tone === "error" ? "alert" : "status"} className="text-sm text-app-fg">
              {notice.text}
            </p>
          ) : null}

          {selectedId !== null ? (
            <ApplicationDetail
              key={selectedId}
              applicationId={selectedId}
              onChanged={(application) =>
                replace({
                  id: application.id,
                  jobId: application.jobId,
                  jobTitle: application.jobTitle,
                  companyId: application.companyId,
                  companyName: application.companyName,
                  status: application.status,
                  createdAt: application.createdAt,
                  statusChangedAt: application.statusChangedAt,
                  jobUrl: application.jobUrl,
                  applyUrl: application.applyUrl,
                })
              }
              onClose={() => setSelectedId(null)}
            />
          ) : null}

          {load.applications.length === 0 ? (
            <p className="text-app-muted">{t("applications.empty")}</p>
          ) : null}
          {load.applications.length > 0 && visible.length === 0 ? (
            <p className="text-app-muted">{t("applications.noMatch")}</p>
          ) : null}

          {view === "list" ? (
            <ul className="flex flex-col gap-2" aria-label={t("applications.title")}>
              {visible.map((application) => renderCard(application))}
            </ul>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {APPLICATION_STATUSES.filter(
                (status) => statusFilter === "" || status === statusFilter,
              ).map((status) => {
                const cards = visible.filter((application) => application.status === status);
                return (
                  <section
                    key={status}
                    aria-labelledby={`board-${status}`}
                    className="flex flex-col gap-2"
                  >
                    <h2 id={`board-${status}`} className="text-base font-medium text-app-fg">
                      {t(`applications.status.${status}`)} ({cards.length})
                    </h2>
                    <ul className="flex flex-col gap-2">{cards.map((card) => renderCard(card))}</ul>
                  </section>
                );
              })}
            </div>
          )}
        </>
      ) : null}
    </main>
  );
}
