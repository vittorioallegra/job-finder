import { Briefcase, Building2, KanbanSquare, Settings, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet } from "react-router";

const NAV_ITEMS = [
  { to: "/jobs", key: "app.nav.jobs", icon: Briefcase },
  { to: "/companies", key: "app.nav.companies", icon: Building2 },
  { to: "/applications", key: "app.nav.applications", icon: KanbanSquare },
  { to: "/profile", key: "app.nav.profile", icon: UserRound },
] as const;

function navClass({ isActive }: { isActive: boolean }): string {
  return `inline-flex items-center gap-2 border-b-2 py-4 text-sm transition-colors ${
    isActive
      ? "border-app-accent font-medium text-app-fg"
      : "border-transparent text-app-muted hover:text-app-fg"
  }`;
}

/** Window frame shared by every screen: top navigation and a centered content column. */
export function AppShell() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-app-border bg-app-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-7 px-6 sm:px-10">
          <Link
            to="/"
            className="font-display text-xl font-bold tracking-tight text-app-fg"
            aria-label={t("app.nav.home")}
          >
            {t("app.brand.first")}
            <span aria-hidden="true" className="text-app-accent">
              {"\u00b7"}
            </span>
            {t("app.brand.second")}
          </Link>
          <nav aria-label={t("app.nav.label")} className="flex min-w-0 flex-1 items-center gap-6">
            {NAV_ITEMS.map(({ to, key, icon: Icon }) => (
              <NavLink key={to} to={to} className={navClass}>
                <Icon aria-hidden="true" className="size-4" strokeWidth={1.8} />
                <span>{t(key)}</span>
              </NavLink>
            ))}
            <span className="flex-1" />
            <NavLink to="/settings" className={navClass}>
              <Settings aria-hidden="true" className="size-4" strokeWidth={1.8} />
              <span>{t("app.nav.settings")}</span>
            </NavLink>
          </nav>
        </div>
      </header>
      <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8 sm:px-10">
        <Outlet />
      </div>
    </div>
  );
}
