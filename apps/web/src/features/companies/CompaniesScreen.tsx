import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Building2, ChevronRight } from "lucide-react";
import { Link } from "react-router";
import type {
  CompanyRecord,
  CompanyScan,
  DirectoryCompany,
  ExcludedCompany,
} from "@job-finder/bridge";
import { useBridge } from "../../lib/bridge/BridgeContext";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { ProfileDiscovery } from "./ProfileDiscovery";

type LoadState =
  { status: "loading" } | { status: "error" } | { status: "ready"; companies: CompanyRecord[] };

/**
 * Companies the engine scans: the search from the profile finds and adds them by itself; this page
 * shows each one with its last scan, and lets the user drop one.
 */
const NAME_ORDER = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** The companies in name order, ignoring case and accents. */
function byName<T extends { name: string }>(companies: readonly T[]): T[] {
  return [...companies].sort((a, b) => NAME_ORDER.compare(a.name, b.name));
}

/** One company on one compact line: name and badge, a line of details, the action on the right. */
function CompanyRow({
  name,
  badge,
  meta,
  metaDanger = false,
  title,
  action,
}: {
  name: string;
  badge?: ReactNode;
  meta: string[];
  metaDanger?: boolean;
  title?: string;
  action: ReactNode;
}) {
  return (
    <li
      title={title}
      className="flex items-center justify-between gap-3 rounded-lg bg-app-sunken px-3 py-1.5"
    >
      <div className="min-w-0">
        <p className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-app-fg">{name}</span>
          {badge}
        </p>
        {meta.length > 0 ? (
          <p className={`truncate text-xs ${metaDanger ? "text-app-danger" : "text-app-muted"}`}>
            {meta.join(" · ")}
          </p>
        ) : null}
      </div>
      <div className="shrink-0">{action}</div>
    </li>
  );
}

type FollowedItem =
  | { kind: "scanned"; name: string; company: CompanyRecord }
  | { kind: "directory"; name: string; company: DirectoryCompany };

export function CompaniesScreen() {
  const { t, i18n } = useTranslation();
  const bridge = useBridge();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  // How many companies the offers come from in all: the followed ones and those the directories gave.
  const [withOffers, setWithOffers] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    bridge.companies.summary().then(
      (summary) => {
        if (active) setWithOffers(summary.withOffers);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [bridge]);
  const [removeFailed, setRemoveFailed] = useState(false);
  const [directory, setDirectory] = useState<DirectoryCompany[]>([]);
  const [directoryQuery, setDirectoryQuery] = useState("");
  useEffect(() => {
    let active = true;
    bridge.companies.directory().then(
      (found) => {
        if (active) setDirectory(found);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [bridge]);
  const [excluded, setExcluded] = useState<ExcludedCompany[]>([]);
  useEffect(() => {
    let active = true;
    bridge.companies.excluded().then(
      (left) => {
        if (active) setExcluded(left);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [bridge]);

  useEffect(() => {
    let active = true;
    bridge.companies.list().then(
      (companies) => {
        if (active) setLoad({ status: "ready", companies });
      },
      () => {
        if (active) setLoad({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [bridge]);

  // A finished run changes each company's last scan, so the list is read again.
  useEffect(
    () =>
      bridge.ingest.onProgress((event) => {
        if (event.kind !== "run-finished") return;
        bridge.companies.list().then(
          (companies) =>
            setLoad((previous) =>
              previous.status === "ready" ? { status: "ready", companies } : previous,
            ),
          () => {},
        );
      }),
    [bridge],
  );

  function retryLoad() {
    setLoad({ status: "loading" });
    bridge.companies.list().then(
      (companies) => setLoad({ status: "ready", companies }),
      () => setLoad({ status: "error" }),
    );
  }

  async function reloadDirectory() {
    try {
      setDirectory(await bridge.companies.directory());
    } catch {
      // The directory companies keep their last list.
    }
  }

  /** Reads the list again, after the search from the profile added companies. */
  async function reloadCompanies() {
    void reloadDirectory();
    try {
      const companies = await bridge.companies.list();
      setLoad((previous) => (previous.status === "ready" ? { ...previous, companies } : previous));
    } catch {
      setLoad({ status: "error" });
    }
  }

  /** Reads both lists again, after a company was excluded or brought back. */
  async function reloadBoth() {
    void reloadDirectory();
    const [companies, left] = await Promise.all([
      bridge.companies.list(),
      bridge.companies.excluded(),
    ]);
    setLoad((previous) => (previous.status === "ready" ? { ...previous, companies } : previous));
    setExcluded(left);
  }

  /** Excludes a company: it stays saved, but it is no longer scanned, listed or found again. */
  async function removeCompany(companyId: string) {
    setRemoveFailed(false);
    try {
      await bridge.companies.remove(companyId);
      await reloadBoth();
    } catch {
      setRemoveFailed(true);
    }
  }

  /** Brings an excluded company back into the sources. */
  async function restoreCompany(companyId: string) {
    setRemoveFailed(false);
    try {
      await bridge.companies.restore(companyId);
      await reloadBoth();
    } catch {
      setRemoveFailed(true);
    }
  }

  const folded = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const needle = folded(directoryQuery.trim());
  // One list: the companies scanned one by one and the ones a job directory gave, by name.
  const followed: FollowedItem[] =
    load.status === "ready"
      ? byName([
          ...load.companies.map((company): FollowedItem => ({
            kind: "scanned",
            company,
            name: company.name,
          })),
          ...directory.map((company): FollowedItem => ({
            kind: "directory",
            company,
            name: company.name,
          })),
        ])
      : [];
  const shownFollowed = followed.filter((item) => folded(item.name).includes(needle));
  const excludedByYou = byName(excluded.filter((company) => company.reason === "user"));
  const excludedByApp = byName(excluded.filter((company) => company.reason !== "user"));

  const failedCount =
    load.status === "ready"
      ? load.companies.filter(
          (company) =>
            company.lastScan?.outcome === "failed" && company.lastScan.code !== "no-parseable-jobs",
        ).length
      : 0;

  function scanSummary(scan: CompanyScan | null): string {
    if (scan === null) return t("companies.scan.never");
    if (scan.outcome === "failed") {
      // A careers page with no readable postings is marked, not reported as a fault.
      if (scan.code === "no-parseable-jobs") return t("companies.scan.noJobs");
      return t("companies.scan.failed", {
        reason: t(`jobs.log.reasons.${scan.code}`, { defaultValue: t("jobs.log.reasons.unknown") }),
      });
    }
    if (scan.jobCount === 0) return t("companies.scan.noJobs");
    return t("companies.scan.scanned", { postings: scan.jobCount, closed: scan.closedCount });
  }

  return (
    <main className="flex flex-col gap-8">
      <PageHeader
        back={
          <Link
            to="/jobs"
            className="inline-flex items-center gap-1.5 text-sm text-app-muted hover:text-app-fg"
          >
            <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.8} />
            {t("companies.backJobs")}
          </Link>
        }
        title={t("companies.title")}
        description={
          withOffers !== null && withOffers > 0
            ? `${t("companies.intro")} ${t("companies.offersFrom", { count: withOffers })}`
            : t("companies.intro")
        }
      />

      {load.status === "loading" ? (
        <p role="status" className="text-app-muted">
          {t("companies.loading")}
        </p>
      ) : null}

      {load.status === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-app-danger">{t("companies.loadFailed")}</p>
          <Button variant="secondary" size="sm" onClick={retryLoad}>
            {t("companies.retry")}
          </Button>
        </div>
      ) : null}

      {load.status === "ready" ? (
        <>
          <ProfileDiscovery bridge={bridge} onAdded={() => void reloadCompanies()} />
          {/* The list is long and rarely needed, so it starts closed with a count and the failures. */}
          <details className="group rounded-2xl border border-app-border bg-app-surface shadow-card">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 select-none [&::-webkit-details-marker]:hidden">
              <ChevronRight
                aria-hidden="true"
                className="size-4 text-app-muted transition-transform group-open:rotate-90"
                strokeWidth={1.8}
              />
              <h2
                id="companies-list-title"
                className="font-sans text-base font-semibold text-app-fg"
              >
                {t("companies.list.summary", { count: followed.length })}
              </h2>
              {failedCount > 0 ? (
                <span className="text-sm text-app-danger">
                  {t("companies.list.failedCount", { count: failedCount })}
                </span>
              ) : null}
            </summary>
            <section
              aria-labelledby="companies-list-title"
              className="flex flex-col gap-4 px-5 pb-5"
            >
              <p className="text-sm text-app-muted">{t("companies.remove.hint")}</p>
              {removeFailed ? (
                <p role="alert" className="text-sm text-app-danger">
                  {t("companies.remove.failed")}
                </p>
              ) : null}
              {followed.length === 0 ? (
                <EmptyState
                  icon={<Building2 className="size-5" strokeWidth={1.8} aria-hidden="true" />}
                  title={t("companies.list.empty")}
                />
              ) : (
                <>
                  <input
                    type="search"
                    value={directoryQuery}
                    onChange={(event) => setDirectoryQuery(event.target.value)}
                    aria-label={t("companies.list.search")}
                    placeholder={t("companies.list.search")}
                    className="rounded-xl border border-app-border bg-app-surface px-3 py-2 text-sm text-app-fg"
                  />
                  {shownFollowed.length === 0 ? (
                    <p className="text-sm text-app-muted">{t("companies.list.none")}</p>
                  ) : (
                    <ul data-list="followed" className="flex flex-col gap-1.5">
                      {shownFollowed.map((item) => {
                        const { company } = item;
                        const country =
                          company.country !== null
                            ? (new Intl.DisplayNames([i18n.language], { type: "region" }).of(
                                company.country,
                              ) ?? company.country)
                            : t("companies.list.countryUnknownShort");
                        const failed =
                          item.kind === "scanned" &&
                          item.company.lastScan?.outcome === "failed" &&
                          item.company.lastScan.code !== "no-parseable-jobs";
                        return (
                          <CompanyRow
                            key={company.id}
                            name={company.name}
                            badge={
                              item.kind === "directory" ? (
                                <Badge tone="neutral">{t("companies.list.directoryBadge")}</Badge>
                              ) : (
                                <Badge tone={item.company.ats ? "neutral" : "accent"}>
                                  {item.company.ats
                                    ? t("companies.list.board", { ats: item.company.ats })
                                    : t("companies.list.careersPage")}
                                </Badge>
                              )
                            }
                            meta={[
                              country,
                              item.kind === "directory"
                                ? t("companies.list.openJobs", { count: item.company.openJobs })
                                : scanSummary(item.company.lastScan),
                            ]}
                            metaDanger={failed}
                            title={item.kind === "scanned" ? item.company.careersUrl : undefined}
                            action={
                              <Button
                                variant="danger"
                                size="sm"
                                aria-label={t("companies.remove.label", { name: company.name })}
                                onClick={() => void removeCompany(company.id)}
                              >
                                {t("companies.remove.action")}
                              </Button>
                            }
                          />
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
            </section>
          </details>
          {excluded.length > 0 ? (
            <details className="group rounded-2xl border border-app-border bg-app-surface shadow-card">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 select-none [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 text-app-muted transition-transform group-open:rotate-90"
                  strokeWidth={1.8}
                />
                <h2 className="font-sans text-base font-semibold text-app-fg">
                  {t("companies.excluded.summary", { count: excluded.length })}
                </h2>
              </summary>
              <section className="flex flex-col gap-3 px-5 pb-5">
                <p className="text-sm text-app-muted">{t("companies.excluded.hint")}</p>
                {(
                  [
                    ["byYou", excludedByYou],
                    ["byApp", excludedByApp],
                  ] as const
                ).map(([group, list]) =>
                  list.length === 0 ? null : (
                    <div key={group} className="flex flex-col gap-2">
                      <h3 className="font-sans text-sm font-semibold text-app-fg">
                        {t(`companies.excluded.${group}`, { count: list.length })}
                      </h3>
                      <ul data-list={group} className="flex flex-col gap-1.5">
                        {list.map((company) => (
                          <CompanyRow
                            key={company.id}
                            name={company.name}
                            meta={
                              company.reason === "user"
                                ? []
                                : [t(`companies.excluded.reason.${company.reason}`)]
                            }
                            action={
                              <Button
                                variant="secondary"
                                size="sm"
                                aria-label={t("companies.excluded.restoreLabel", {
                                  name: company.name,
                                })}
                                onClick={() => void restoreCompany(company.id)}
                              >
                                {t("companies.excluded.restore")}
                              </Button>
                            }
                          />
                        ))}
                      </ul>
                    </div>
                  ),
                )}
              </section>
            </details>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
