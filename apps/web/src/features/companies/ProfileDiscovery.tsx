import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { Sparkles } from "lucide-react";
import type { JobFinderBridge, ProfileDiscoveryResult } from "@job-finder/bridge";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";

export interface ProfileDiscoveryProps {
  bridge: JobFinderBridge;
  /** Called after the search added companies, so the list can be read again. */
  onAdded: () => void;
}

/**
 * The company search from the profile's "what you are looking for": its roles, a button that finds
 * and adds the companies hiring for them (then scans them), and what it did. `?discover=1` (the end
 * of profile setup, or a change of roles) starts it once by itself.
 */
export function ProfileDiscovery({ bridge, onAdded }: ProfileDiscoveryProps) {
  const { t } = useTranslation();
  const [roles, setRoles] = useState<string[] | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ProfileDiscoveryResult | null>(null);

  useEffect(() => {
    let active = true;
    bridge.profile.get().then(
      (record) => {
        if (active) setRoles(record?.profile.preferences.roles ?? []);
      },
      () => {
        if (active) setRoles([]);
      },
    );
    return () => {
      active = false;
    };
  }, [bridge]);

  const run = useCallback(async () => {
    setRunning(true);
    setResult(null);
    try {
      const outcome = await bridge.discovery.fromProfile();
      setResult(outcome);
      if (outcome.ok && outcome.added > 0) onAdded();
    } catch {
      setResult({ ok: false, code: "engine-unavailable" });
    } finally {
      setRunning(false);
    }
  }, [bridge, onAdded]);

  const [params, setParams] = useSearchParams();
  const wantsRun = params.get("discover") === "1";
  const runOnce = useRef(run);
  useEffect(() => {
    runOnce.current = run;
  });
  useEffect(() => {
    if (!wantsRun || roles === null) return;
    setParams({}, { replace: true });
    if (roles.length > 0) void runOnce.current();
  }, [wantsRun, roles, setParams]);

  const hasRoles = roles !== null && roles.length > 0;
  return (
    <Card as="section" aria-labelledby="profile-discovery-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Sparkles aria-hidden="true" className="size-4 text-app-accent" strokeWidth={1.8} />
        <CardTitle id="profile-discovery-title">{t("companies.profileSearch.heading")}</CardTitle>
        <span className="flex-1" />
        {hasRoles ? (
          <Button variant="secondary" size="sm" onClick={() => void run()} disabled={running}>
            {running ? t("companies.profileSearch.searching") : t("companies.profileSearch.start")}
          </Button>
        ) : null}
      </div>
      {roles === null ? null : hasRoles ? (
        <p className="text-sm text-app-muted">
          {t("companies.profileSearch.intro", { roles: roles.join(", ") })}
        </p>
      ) : (
        <p className="text-sm text-app-muted">
          {t("companies.profileSearch.needRoles")}{" "}
          <Link to="/profile" className="text-app-accent underline">
            {t("companies.profileSearch.openProfile")}
          </Link>
        </p>
      )}
      {running ? (
        <p role="status" className="text-sm text-app-muted">
          {t("companies.profileSearch.searchingLong")}
        </p>
      ) : null}
      {result ? <Outcome result={result} /> : null}
    </Card>
  );
}

/** What the search did, or why it could not. */
function Outcome({ result }: { result: ProfileDiscoveryResult }) {
  const { t } = useTranslation();
  if (!result.ok) {
    return (
      <p role="alert" className="text-sm text-app-danger">
        {t(`companies.profileSearch.failure.${result.code}`)}
      </p>
    );
  }
  return (
    <p role="status" className="text-sm text-app-fg">
      {result.added > 0
        ? t("companies.profileSearch.added", { count: result.added, found: result.found })
        : result.found > 0
          ? t("companies.profileSearch.nothingNew", { count: result.found })
          : t("companies.profileSearch.none")}
      {result.runStarted ? ` ${t("companies.profileSearch.scanning")}` : ""}
      {result.searchBlocked ? ` ${t("companies.profileSearch.blocked")}` : ""}
    </p>
  );
}
