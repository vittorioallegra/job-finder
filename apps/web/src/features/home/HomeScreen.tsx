import { useTranslation } from "react-i18next";
import { Link } from "react-router";

export function HomeScreen() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-8">
      <h1 className="text-3xl font-semibold text-app-fg">{t("home.title")}</h1>
      <p className="text-app-muted">{t("home.subtitle")}</p>
      <section
        aria-labelledby="home-empty-title"
        className="rounded-lg border border-app-border p-6"
      >
        <h2 id="home-empty-title" className="text-lg font-medium">
          {t("home.emptyTitle")}
        </h2>
        <p className="text-app-muted">{t("home.emptyBody")}</p>
      </section>
      <Link to="/settings" className="w-fit text-app-accent underline">
        {t("home.openSettings")}
      </Link>
    </main>
  );
}
