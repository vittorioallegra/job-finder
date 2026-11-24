import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Building2 } from "lucide-react";
import { Link } from "react-router";
import type {
  CompanyAddFailureCode,
  CompanyRecord,
  CompanyScan,
  DiscoveryCandidate,
  DiscoverySearchFailureCode,
  IngestStartFailureCode,
  SecretName,
} from "@job-finder/bridge";
import { useBridge } from "../../lib/bridge/BridgeContext";
import { Badge } from "../../components/ui/Badge";
import { Button, buttonClass } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { TextInput } from "../../components/ui/TextInput";

type LoadState =
  { status: "loading" } | { status: "error" } | { status: "ready"; companies: CompanyRecord[] };

type SearchState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "done"; candidates: DiscoveryCandidate[]; searchBlocked: boolean }
  | { status: "failed"; code: DiscoverySearchFailureCode };

/** The keyed search providers. Reliable discovery needs one of their keys (Settings). */
const SEARCH_KEY_NAMES: readonly SecretName[] = ["search.brave", "search.tavily", "search.serper"];

type ScanNotice =
  | { companyId: string; status: "started" }
  | { companyId: string; status: "failed"; code: IngestStartFailureCode };

/** Comma-separated terms, trimmed, empty ones dropped, at most five (the most the search accepts). */
export function splitTerms(value: string): string[] {
  return value
    .split(",")
    .map((term) => term.trim())
    .filter((term) => term !== "")
    .slice(0, 5);
}

/** Points to Settings, where the free-tier search keys are saved. */
function SettingsLinkHint() {
  const { t } = useTranslation();
  return (
    <p className="text-sm text-app-muted">
      {t("companies.discover.blockedHint")}{" "}
      <Link to="/settings" className="text-app-accent underline">
        {t("companies.discover.openSettings")}
      </Link>
    </p>
  );
}

/**
 * Companies the engine scans: find boards by keyword, add one by its careers link, and see each
 * company's last scan with a retry. Found boards are added only when the user picks them.
 */
export function CompaniesScreen() {
  const { t } = useTranslation();
  const bridge = useBridge();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [keywords, setKeywords] = useState("");
  const [locations, setLocations] = useState("");
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const [discoverFailure, setDiscoverFailure] = useState<CompanyAddFailureCode | "unknown" | null>(
    null,
  );
  const [name, setName] = useState("");
  const [careersUrl, setCareersUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [addFailure, setAddFailure] = useState<CompanyAddFailureCode | "unknown" | null>(null);
  const [scanNotice, setScanNotice] = useState<ScanNotice | null>(null);
  const [removeFailed, setRemoveFailed] = useState(false);
  // Null until the key status is read; the hint to Settings is shown only once it says no key is set.
  const [hasSearchKey, setHasSearchKey] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    bridge.secrets.status().then(
      (status) => {
        if (active) setHasSearchKey(SEARCH_KEY_NAMES.some((name) => status.keys[name]));
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

  function appendCompany(company: CompanyRecord) {
    setLoad((previous) =>
      previous.status === "ready"
        ? { status: "ready", companies: [...previous.companies, company] }
        : previous,
    );
  }

  async function searchBoards(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch({ status: "searching" });
    setDiscoverFailure(null);
    try {
      const result = await bridge.discovery.search({
        keywords: splitTerms(keywords),
        locations: splitTerms(locations),
      });
      setSearch(
        result.ok
          ? {
              status: "done",
              candidates: result.candidates,
              searchBlocked: result.searchBlocked === true,
            }
          : { status: "failed", code: result.code },
      );
    } catch {
      setSearch({ status: "failed", code: "engine-unavailable" });
    }
  }

  /** Removes a company from the sources; adding it by hand brings it back. */
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

  async function addCandidate(candidate: DiscoveryCandidate) {
    setDiscoverFailure(null);
    try {
      const result = await bridge.companies.add({
        name: candidate.name,
        careersUrl: candidate.careersUrl,
      });
      if (result.ok) {
        appendCompany(result.company);
      } else {
        setDiscoverFailure(result.code);
      }
    } catch {
      setDiscoverFailure("unknown");
    }
  }

  async function addCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdding(true);
    setAdded(false);
    setAddFailure(null);
    try {
      const result = await bridge.companies.add({ name, careersUrl });
      if (result.ok) {
        appendCompany(result.company);
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

  async function retryScan(companyId: string) {
    setScanNotice(null);
    try {
      const result = await bridge.ingest.start(companyId);
      setScanNotice(
        result.ok
          ? { companyId, status: "started" }
          : { companyId, status: "failed", code: result.code },
      );
    } catch {
      setScanNotice({ companyId, status: "failed", code: "engine-unavailable" });
    }
  }

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

  function isAdded(candidate: DiscoveryCandidate, companies: CompanyRecord[]): boolean {
    return companies.some(
      (company) => company.ats === candidate.ats && company.slug === candidate.slug,
    );
  }

  return (
    <main className="flex flex-col gap-8">
      <PageHeader
        title={t("companies.title")}
        description={t("companies.intro")}
        actions={
          <Link to="/jobs" className={buttonClass("secondary", "sm")}>
            {t("companies.backJobs")}
          </Link>
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
          <section aria-labelledby="companies-list-title" className="flex flex-col gap-4">
            <h2 id="companies-list-title" className="sr-only">
              {t("companies.list.heading")}
            </h2>
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
                    <p
                      className={`text-sm ${company.lastScan?.outcome === "failed" && company.lastScan.code !== "no-parseable-jobs" ? "text-app-danger" : "text-app-fg"}`}
                    >
                      {scanSummary(company.lastScan)}
                    </p>
                    <div className="flex items-center gap-3">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void retryScan(company.id)}
                      >
                        {t("companies.scan.retry")}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        aria-label={t("companies.remove.label", { name: company.name })}
                        onClick={() => void removeCompany(company.id)}
                      >
                        {t("companies.remove.action")}
                      </Button>
                      {scanNotice?.companyId === company.id ? (
                        scanNotice.status === "started" ? (
                          <p role="status" className="text-sm text-app-good">
                            {t("companies.scan.started")}
                          </p>
                        ) : (
                          <p role="alert" className="text-sm text-app-danger">
                            {t(
                              scanNotice.code === "already-running"
                                ? "companies.scan.alreadyRunning"
                                : "companies.scan.engineUnavailable",
                            )}
                          </p>
                        )
                      ) : null}
                    </div>
                  </Card>
                ))}
              </ul>
            )}
          </section>
          <Card
            as="section"
            aria-labelledby="companies-discover-title"
            className="flex flex-col gap-4"
          >
            <CardTitle id="companies-discover-title">{t("companies.discover.heading")}</CardTitle>
            <p className="text-sm text-app-muted">{t("companies.discover.intro")}</p>
            {hasSearchKey === false ? (
              <p className="text-sm text-app-muted">
                {t("companies.discover.keyHint")}{" "}
                <Link to="/settings" className="text-app-accent underline">
                  {t("companies.discover.openSettings")}
                </Link>
              </p>
            ) : null}
            <form onSubmit={searchBoards} className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextInput
                  label={t("companies.discover.keywords")}
                  hint={t("companies.discover.keywordsHint")}
                  value={keywords}
                  maxLength={500}
                  required
                  onChange={(event) => setKeywords(event.target.value)}
                />
                <TextInput
                  label={t("companies.discover.locations")}
                  hint={t("companies.discover.locationsHint")}
                  value={locations}
                  maxLength={500}
                  onChange={(event) => setLocations(event.target.value)}
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={search.status === "searching" || splitTerms(keywords).length === 0}
                >
                  {t("companies.discover.submit")}
                </Button>
              </div>
            </form>

            {search.status === "searching" ? (
              <p role="status" className="text-sm text-app-muted">
                {t("companies.discover.searching")}
              </p>
            ) : null}
            {search.status === "failed" ? (
              <>
                <p role="alert" className="text-sm text-app-danger">
                  {t(`companies.discover.failure.${search.code}`)}
                </p>
                {search.code === "search-blocked" ? <SettingsLinkHint /> : null}
              </>
            ) : null}
            {search.status === "done" && search.candidates.length === 0 ? (
              <p className="text-sm text-app-muted">{t("companies.discover.none")}</p>
            ) : null}
            {search.status === "done" && search.searchBlocked ? <SettingsLinkHint /> : null}
            {search.status === "done" && search.candidates.length > 0 ? (
              <>
                <p role="status" className="text-sm text-app-muted">
                  {t("companies.discover.boardsFound", { count: search.candidates.length })}
                </p>
                <ul className="flex flex-col gap-2">
                  {search.candidates.map((candidate) => {
                    const alreadyAdded = isAdded(candidate, load.companies);
                    return (
                      <li
                        key={`${candidate.ats}/${candidate.slug}`}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-app-sunken p-3"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-app-fg">{candidate.name}</p>
                          <p className="mt-0.5">
                            <Badge>{t("companies.list.board", { ats: candidate.ats })}</Badge>
                          </p>
                          <p className="mt-1 text-xs break-all text-app-muted">
                            {candidate.careersUrl}
                          </p>
                        </div>
                        {alreadyAdded ? (
                          <Badge tone="good">{t("companies.discover.alreadyAdded")}</Badge>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => void addCandidate(candidate)}
                          >
                            {t("companies.discover.add", { name: candidate.name })}
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : null}
            {discoverFailure ? (
              <p role="alert" className="text-sm text-app-danger">
                {t(`companies.add.failure.${discoverFailure}`)}
              </p>
            ) : null}
          </Card>

          <Card as="section" aria-labelledby="companies-add-title" className="flex flex-col gap-4">
            <CardTitle id="companies-add-title">{t("companies.add.heading")}</CardTitle>
            <form onSubmit={addCompany} className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextInput
                  label={t("companies.add.name")}
                  value={name}
                  maxLength={200}
                  required
                  onChange={(event) => setName(event.target.value)}
                />
                <TextInput
                  label={t("companies.add.careersUrl")}
                  hint={t("companies.add.careersUrlHint")}
                  type="url"
                  value={careersUrl}
                  required
                  onChange={(event) => setCareersUrl(event.target.value)}
                />
              </div>
              {addFailure ? (
                <p role="alert" className="text-sm text-app-danger">
                  {t(`companies.add.failure.${addFailure}`)}
                </p>
              ) : null}
              {added ? (
                <p role="status" className="text-sm text-app-good">
                  {t("companies.add.added")}
                </p>
              ) : null}
              <div className="flex justify-end">
                <Button type="submit" disabled={adding}>
                  {t("companies.add.submit")}
                </Button>
              </div>
            </form>
          </Card>
        </>
      ) : null}
    </main>
  );
}
