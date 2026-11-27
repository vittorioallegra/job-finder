import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { UserRound } from "lucide-react";
import { Link } from "react-router";
import type { ProfileRecord } from "@job-finder/bridge";
import { useBridge } from "../../lib/bridge/BridgeContext";
import { Button, buttonClass } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { ProfileEditor } from "./ProfileEditor";
import { ProfileExport } from "./ProfileExport";
import { ProfileReview } from "./ProfileReview";
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
  const [searchChanged, setSearchChanged] = useState(false);

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
    <main className="flex w-full flex-col gap-8">
      <PageHeader title={t("profile.title")} />

      {state.status === "loading" ? (
        <p role="status" className="text-app-muted">
          {t("profile.loading")}
        </p>
      ) : null}

      {state.status === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-app-danger">{t("profile.loadFailed")}</p>
          <Button variant="secondary" size="sm" onClick={retry}>
            {t("profile.retry")}
          </Button>
        </div>
      ) : null}

      {state.status === "empty" ? (
        <EmptyState
          icon={<UserRound className="size-5" strokeWidth={1.8} aria-hidden="true" />}
          title={t("profile.empty.title")}
          body={t("profile.empty.body")}
          action={
            <Link to="/onboarding" className={buttonClass("accent")}>
              {t("profile.empty.start")}
            </Link>
          }
        />
      ) : null}

      {searchChanged ? (
        <p role="note" className="rounded-xl bg-app-accent-soft p-3 text-sm text-app-fg">
          {t("profile.searchChanged")}{" "}
          <Link to="/companies?discover=1" className="font-medium text-app-accent underline">
            {t("profile.searchChangedAction")}
          </Link>
        </p>
      ) : null}

      {state.status === "ready" ? <ProfileExport /> : null}

      {state.status === "ready" ? <ProfileReview key={state.record.version} /> : null}

      {state.status === "ready" ? (
        <ProfileEditor
          initialDraft={draftFromProfile(state.record.profile)}
          onSaved={(record) => {
            // New roles or places point to other companies: offer the search right away.
            const before = state.record.profile.preferences;
            const after = record.profile.preferences;
            if (
              after.roles.length > 0 &&
              (JSON.stringify(before.roles) !== JSON.stringify(after.roles) ||
                JSON.stringify(before.locations) !== JSON.stringify(after.locations))
            ) {
              setSearchChanged(true);
            }
            setState({ status: "ready", record });
          }}
        />
      ) : null}
    </main>
  );
}
