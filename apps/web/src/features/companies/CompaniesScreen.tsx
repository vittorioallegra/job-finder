import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Building2, ChevronRight } from "lucide-react";
import { Link } from "react-router";
import type { CompanyRecord, CompanyScan } from "@job-finder/bridge";
import { useBridge } from "../../lib/bridge/BridgeContext";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { ProfileDiscovery } from "./ProfileDiscovery";

type LoadState =
  { status: "loading" } | { status: "error" } | { status: "ready"; companies: CompanyRecord[] };

/**
 * Companies the engine scans: the search from the profile finds and adds them by itself; this page
 * shows each one with its last scan, and lets the user drop one.
 */
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

  /** Reads the list again, after the search from the profile added companies. */
  async function reloadCompanies() {
    try {
      const companies = await bridge.companies.list();
      setLoad((previous) => (previous.status === "ready" ? { ...previous, companies } : previous));
    } catch {
      setLoad({ status: "error" });
    }
  }

  /** Removes a company from the sources: no more scans, and the search does not add it again. */
  async function removeCompany(companyId: string) {
    setRemoveFailed(false);
    try {
      await bridge.companies.remove(companyId);
      const companies = await bridge.companies.list();
      setLoad((previous) => (previous.status === "ready" ? { ...previous, companies } : previous));
    } catch {
      setRemoveFailed(true);
    }
  }

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
                {t("companies.list.summary", { count: load.companies.length })}
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
              {load.companies.length === 0 ? (
                <EmptyState
                  icon={<Building2 className="size-5" strokeWidth={1.8} aria-hidden="true" />}
                  title={t("companies.list.empty")}
                />
              ) : (
                <ul className="grid gap-3 md:grid-cols-2">
                  {load.companies.map((company) => (
                    <Card as="li" key={company.id} className="flex flex-col gap-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-display text-lg font-semibold text-app-fg">
                          {company.name}
                        </p>
                        <Badge tone={company.ats ? "neutral" : "accent"}>
                          {company.ats
                            ? t("companies.list.board", { ats: company.ats })
                            : t("companies.list.careersPage")}
                        </Badge>
                      </div>
                      <p className="text-xs break-all text-app-muted">{company.careersUrl}</p>
                      <p className="text-sm text-app-muted">
                        {company.country !== null
                          ? t("companies.list.country", {
                              country: new Intl.DisplayNames([i18n.language], {
                                type: "region",
                              }).of(company.country),
                            })
                          : t("companies.list.countryUnknown")}
                      </p>
                      <p
                        className={`text-sm ${company.lastScan?.outcome === "failed" && company.lastScan.code !== "no-parseable-jobs" ? "text-app-danger" : "text-app-fg"}`}
                      >
                        {scanSummary(company.lastScan)}
                      </p>
                      <div className="flex items-center gap-3">
                        <Button
                          variant="danger"
                          size="sm"
                          aria-label={t("companies.remove.label", { name: company.name })}
                          onClick={() => void removeCompany(company.id)}
                        >
                          {t("companies.remove.action")}
                        </Button>
                      </div>
                    </Card>
                  ))}
                </ul>
              )}
            </section>
          </details>
        </>
      ) : null}
    </main>
  );
}
