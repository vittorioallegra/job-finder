import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { ProfileRecord } from "@job-finder/bridge";
import { useBridge } from "../../lib/bridge/BridgeContext";
import { Button } from "../../components/ui/Button";
import { ProfileEditor } from "./ProfileEditor";
import { draftFromProfile } from "./profile-draft";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "empty" }
  | { status: "ready"; record: ProfileRecord };

/** Edits the saved profile. Before onboarding there is nothing to edit, so the screen links to onboarding. */
export function ProfileScreen() {
  const { t } = useTranslation();
  const bridge = useBridge();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async (): Promise<LoadState> => {
    try {
      const record = await bridge.profile.get();
      return record ? { status: "ready", record } : { status: "empty" };
    } catch {
      return { status: "error" };
    }
  }, [bridge]);

  useEffect(() => {
    let active = true;
    void load().then((next) => {
      if (active) {
        setState(next);
      }
    });
    return () => {
      active = false;
    };
  }, [load]);

  function retry() {
    setState({ status: "loading" });
    void load().then(setState);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <nav>
        <Link to="/" className="text-sm text-app-accent underline">
          {t("profile.backHome")}
        </Link>
      </nav>
      <h1 className="text-3xl font-semibold text-app-fg">{t("profile.title")}</h1>

      {state.status === "loading" ? (
        <p role="status" className="text-app-muted">
          {t("profile.loading")}
        </p>
      ) : null}

      {state.status === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-app-fg">{t("profile.loadFailed")}</p>
          <Button variant="secondary" onClick={retry}>
            {t("profile.retry")}
          </Button>
        </div>
      ) : null}

      {state.status === "empty" ? (
        <section
          aria-labelledby="profile-empty-title"
          className="flex flex-col items-start gap-3 rounded-lg border border-app-border p-6"
        >
          <h2 id="profile-empty-title" className="text-lg font-medium text-app-fg">
            {t("profile.empty.title")}
          </h2>
          <p className="text-app-muted">{t("profile.empty.body")}</p>
          <Link to="/onboarding" className="text-app-accent underline">
            {t("profile.empty.start")}
          </Link>
        </section>
      ) : null}

      {state.status === "ready" ? (
        <ProfileEditor initialDraft={draftFromProfile(state.record.profile)} />
      ) : null}
    </main>
  );
}
