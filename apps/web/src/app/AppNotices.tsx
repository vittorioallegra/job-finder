import { useEffect, useState } from "react";
import { AlertTriangle, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AppStatus } from "@job-finder/bridge";
import { useBridge } from "../lib/bridge/BridgeContext";
import { Button } from "../components/ui/Button";

/**
 * Notices from the app itself: a stopped search engine, and a newer release. A release notice can
 * be dismissed for the session; the engine notice stays until the app restarts.
 */
export function AppNotices() {
  const { t } = useTranslation();
  const bridge = useBridge();
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [openFailed, setOpenFailed] = useState(false);

  useEffect(() => {
    let active = true;
    bridge.app.status().then(
      (next) => {
        if (active) setStatus(next);
      },
      () => {},
    );
    const unsubscribe = bridge.app.onStatusChange((next) => {
      if (active) setStatus(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge]);

  if (status === null) return null;
  const update = status.update && status.update.version !== dismissed ? status.update : null;
  if (status.engine !== "failed" && update === null) return null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-6 pt-3">
      {status.engine === "failed" ? (
        <p
          role="alert"
          className="flex items-center gap-2.5 rounded-xl bg-app-danger-soft px-4 py-2.5 text-sm text-app-danger"
        >
          <AlertTriangle className="size-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
          {t("app.notices.engineFailed")}
        </p>
      ) : null}
      {update ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-xl bg-app-accent-soft px-4 py-2.5 text-sm text-app-fg"
        >
          <Sparkles
            className="size-4 shrink-0 text-app-accent"
            strokeWidth={1.8}
            aria-hidden="true"
          />
          <span className="flex-1">
            {t("app.notices.updateAvailable", { version: update.version })}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setOpenFailed(false);
              bridge.app.openUpdate().then(
                (opened) => setOpenFailed(!opened),
                () => setOpenFailed(true),
              );
            }}
          >
            {t("app.notices.openRelease")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDismissed(update.version)}>
            {t("app.notices.dismiss")}
          </Button>
          {openFailed ? (
            <span className="text-app-danger">{t("app.notices.openFailed")}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
