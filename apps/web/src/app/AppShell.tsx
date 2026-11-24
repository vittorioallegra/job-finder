import { Briefcase, KanbanSquare, Settings, UserRound, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { buttonClass } from "../components/ui/Button";

const NAV_ITEMS = [
  { to: "/jobs", key: "app.nav.jobs", icon: Briefcase },
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

/** The app's name as the header shows it. */
function Brand() {
  const { t } = useTranslation();
  return (
    <>
      {t("app.brand.first")}
      <span aria-hidden="true" className="text-app-accent">
        {"\u00b7"}
      </span>
      {t("app.brand.second")}
    </>
  );
}

const BRAND_CLASS = "font-display text-xl font-bold tracking-tight text-app-fg";

/**
 * Window frame shared by every screen: top navigation and a centered content column. Profile
 * setup is a focused flow: the menu gives way to a single way out, back to the home screen.
 */
export function AppShell() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const focused = pathname === "/onboarding";
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-app-border bg-app-bg/90 backdrop-blur">
        {focused ? (
          <div className="mx-auto flex max-w-6xl items-center gap-7 px-6 py-3 sm:px-10">
            <span className={BRAND_CLASS}>
              <Brand />
            </span>
            <span className="flex-1" />
            <Link to="/" className={buttonClass("ghost", "sm")}>
              <X aria-hidden="true" className="size-4" strokeWidth={1.8} />
              {t("app.nav.exitSetup")}
            </Link>
          </div>
        ) : (
          <div className="mx-auto flex max-w-6xl items-center gap-7 px-6 sm:px-10">
            <Link to="/" className={BRAND_CLASS} aria-label={t("app.nav.home")}>
              <Brand />
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
        )}
      </header>
      <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8 sm:px-10">
        <Outlet />
      </div>
    </div>
  );
}
