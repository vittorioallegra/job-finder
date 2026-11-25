import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Briefcase, Download } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import {
  APPLICATION_STATUSES,
  canTransition,
  type ApplicationStatus,
  type ApplicationSummary,
} from "@job-finder/bridge";
import { useBridge } from "../../lib/bridge/BridgeContext";
import { Button, buttonClass } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Drawer } from "../../components/ui/Drawer";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
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
  // Preparing an application from a job opens it here (`?open=<id>&generate=1`): its documents are
  // generated at once when the AI can be used without a consent step. The link is read once.
  const [params, setParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(() => params.get("open"));
  const [autoGenerate] = useState(() => params.get("generate") === "1");
  useEffect(() => {
    if (params.has("open") || params.has("generate")) setParams({}, { replace: true });
  }, [params, setParams]);
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

  function renderCard(application: ApplicationSummary, layout: "row" | "card") {
    const options = statusOptions(application);
    const wrapper =
      layout === "row"
        ? "grid items-center gap-x-4 gap-y-2 px-5 py-4 sm:grid-cols-[1fr_12rem_auto]"
        : "flex flex-col gap-2 rounded-xl border border-app-border bg-app-surface p-3.5 shadow-card";
    return (
      <li key={application.id} className={wrapper}>
        <div className="min-w-0">
          <p className="font-display text-base font-semibold text-app-fg">{application.jobTitle}</p>
          <p className="text-sm text-app-muted">
            {application.companyName} ·{" "}
            {t("applications.changed", {
              date: new Date(application.statusChangedAt).toLocaleDateString(i18n.language),
            })}
          </p>
        </div>
        <SelectInput
          label={t("applications.cardStatus", { title: application.jobTitle })}
          hideLabel
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
            size="sm"
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
    <main className="flex flex-col gap-8">
      <PageHeader
        title={t("applications.title")}
        actions={
          <>
            <Link to="/jobs" className={buttonClass("ghost", "sm")}>
              {t("applications.backToJobs")}
            </Link>
            {load.status === "ready" ? (
              <Button variant="secondary" size="sm" onClick={() => void exportCsv()}>
                <Download className="size-4" strokeWidth={1.8} aria-hidden="true" />
                {t("applications.export.button")}
              </Button>
            ) : null}
          </>
        }
      />

      {load.status === "loading" ? (
        <p role="status" className="text-app-muted">
          {t("applications.loading")}
        </p>
      ) : null}

      {load.status === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-app-danger">{t("applications.loadFailed")}</p>
          <Button
            variant="secondary"
            size="sm"
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
                <button
                  key={option}
                  type="button"
                  aria-pressed={view === option}
                  onClick={() => setView(option)}
                  className={`rounded-full px-3.5 py-1.5 text-[13px] transition-colors ${
                    view === option
                      ? "bg-app-accent text-app-accent-fg"
                      : "bg-app-sunken text-app-muted hover:text-app-fg"
                  }`}
                >
                  {t(`applications.view.${option}`)}
                </button>
              ))}
            </div>
            <span className="flex-1" />
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
          </div>

          {notice ? (
            <p
              role={notice.tone === "error" ? "alert" : "status"}
              className={`text-sm ${notice.tone === "error" ? "text-app-danger" : "text-app-good"}`}
            >
              {notice.text}
            </p>
          ) : null}

          {selectedId !== null ? (
            <Drawer label={t("applications.detail.heading")} onClose={() => setSelectedId(null)}>
              <ApplicationDetail
                key={selectedId}
                applicationId={selectedId}
                autoGenerate={autoGenerate}
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
            </Drawer>
          ) : null}

          {load.applications.length === 0 ? (
            <EmptyState
              icon={<Briefcase className="size-5" strokeWidth={1.8} aria-hidden="true" />}
              title={t("applications.empty")}
            />
          ) : null}
          {load.applications.length > 0 && visible.length === 0 ? (
            <EmptyState title={t("applications.noMatch")} />
          ) : null}

          {view === "list" ? (
            visible.length > 0 ? (
              <Card padded={false} className="overflow-hidden">
                <ul className="divide-y divide-app-border" aria-label={t("applications.title")}>
                  {visible.map((application) => renderCard(application, "row"))}
                </ul>
              </Card>
            ) : (
              <ul aria-label={t("applications.title")} />
            )
          ) : (
            <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2">
              {APPLICATION_STATUSES.filter(
                (status) => statusFilter === "" || status === statusFilter,
              ).map((status) => {
                const cards = visible.filter((application) => application.status === status);
                return (
                  <section
                    key={status}
                    aria-labelledby={`board-${status}`}
                    className="flex w-72 shrink-0 flex-col gap-3 rounded-2xl bg-app-sunken p-3"
                  >
                    <h2
                      id={`board-${status}`}
                      className="flex items-center justify-between px-1 font-sans text-sm font-semibold text-app-fg"
                    >
                      <span>
                        {t(`applications.status.${status}`)} ({cards.length})
                      </span>
                    </h2>
                    <ul className="flex flex-col gap-2">
                      {cards.map((card) => renderCard(card, "card"))}
                    </ul>
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
