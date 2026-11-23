import { useTranslation } from "react-i18next";

export function NotFoundScreen() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto max-w-2xl p-8">
      <p className="text-app-muted">{t("app.notFound")}</p>
    </main>
  );
}
