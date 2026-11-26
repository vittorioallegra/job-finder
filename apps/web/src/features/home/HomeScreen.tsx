import { Briefcase, Check, KanbanSquare, Target, UserRound, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { Button, buttonClass } from "../../components/ui/Button";
import { useBridge } from "../../lib/bridge/BridgeContext";

interface Overview {
  hasProfile: boolean;
  /** The roles "what you are looking for" names; they decide which companies are searched. */
  roles: string[];
  companies: number;
  activeApplications: number;
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; overview: Overview };

const CLOSED_STATUSES = new Set(["rejected", "accepted"]);

export function HomeScreen() {
  const { t } = useTranslation();
  const bridge = useBridge();
  const [state, setState] = useState<State>({ kind: "loading" });

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([bridge.profile.get(), bridge.companies.list(), bridge.applications.list()])
      .then(([profile, companies, applications]) => {
        if (!active) return;
        setState({
          kind: "ready",
          overview: {
            hasProfile: profile !== null,
            roles: profile?.profile.preferences.roles ?? [],
            companies: companies.length,
            activeApplications: applications.filter((a) => !CLOSED_STATUSES.has(a.status)).length,
          },
        });
      })
      .catch(() => {
        if (active) setState({ kind: "error" });
      });
    return () => {
      active = false;
    };
  }, [bridge, attempt]);

  function retry() {
    setState({ kind: "loading" });
    setAttempt((n) => n + 1);
  }

  return (
    <main className="flex flex-col gap-8">
      <PageHeader title={t("home.title")} description={t("home.subtitle")} />
      {state.kind === "loading" ? (
        <p role="status" className="text-app-muted">
          {t("home.loading")}
        </p>
      ) : state.kind === "error" ? (
        <EmptyState
          role="alert"
          title={t("home.loadFailed")}
          action={
            <Button variant="secondary" onClick={retry}>
              {t("home.retry")}
            </Button>
          }
        />
      ) : (
        <ol className="grid gap-5 sm:grid-cols-2">
          <StepCard
            step={1}
            icon={UserRound}
            title={t("home.profileTitle")}
            body={state.overview.hasProfile ? t("home.profileReady") : t("home.profileMissing")}
            done={state.overview.hasProfile}
            to={state.overview.hasProfile ? "/profile" : "/onboarding"}
            action={state.overview.hasProfile ? t("home.profileEdit") : t("home.profileAction")}
          />
          <StepCard
            step={2}
            icon={Target}
            title={t("home.searchTitle")}
            body={
              state.overview.roles.length > 0
                ? t("home.searchReady", {
                    roles: state.overview.roles.join(", "),
                    count: state.overview.companies,
                  })
                : t("home.searchEmpty")
            }
            done={state.overview.roles.length > 0}
            to={state.overview.hasProfile ? "/profile" : "/onboarding"}
            action={state.overview.roles.length > 0 ? t("home.searchEdit") : t("home.searchAction")}
          />
          <StepCard
            step={3}
            icon={Briefcase}
            title={t("home.jobsTitle")}
            body={t("home.jobsBody")}
            done={false}
            to="/jobs"
            action={t("home.jobsAction")}
          />
          <StepCard
            icon={KanbanSquare}
            title={t("home.applicationsTitle")}
            body={
              state.overview.activeApplications > 0
                ? t("home.applicationsCount", { count: state.overview.activeApplications })
                : t("home.applicationsEmpty")
            }
            done={false}
            to="/applications"
            action={t("home.applicationsAction")}
          />
        </ol>
      )}
    </main>
  );
}

interface StepCardProps {
  step?: number;
  icon: LucideIcon;
  title: string;
  body: string;
  done: boolean;
  to: string;
  action: string;
}

function StepCard({ step, icon: Icon, title, body, done, to, action }: StepCardProps) {
  const { t } = useTranslation();
  return (
    <Card as="li" className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <div className="grid size-11 flex-none place-items-center rounded-full bg-app-accent-soft text-app-accent">
          <Icon aria-hidden="true" className="size-5" strokeWidth={1.8} />
        </div>
        <div className="min-w-0">
          {step ? (
            <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-app-subtle uppercase">
              {t("home.stepLabel", { n: step })}
              {done ? (
                <Check aria-hidden="true" className="size-3.5 text-app-good" strokeWidth={2.4} />
              ) : null}
            </p>
          ) : null}
          <h2 className="font-display text-xl font-semibold text-app-fg">{title}</h2>
          <p className="mt-1 text-app-muted">{body}</p>
        </div>
      </div>
      <div className="mt-auto flex justify-end border-t border-dashed border-app-border pt-4">
        <Link to={to} className={buttonClass("secondary", "sm")}>
          {action}
        </Link>
      </div>
    </Card>
  );
}
