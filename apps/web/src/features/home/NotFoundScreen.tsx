import { Compass } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../components/ui/EmptyState";

export function NotFoundScreen() {
  const { t } = useTranslation();
  return (
    <main className="flex flex-col gap-8">
      <EmptyState
        icon={<Compass className="size-5" strokeWidth={1.8} aria-hidden="true" />}
        title={t("app.notFound")}
      />
    </main>
  );
}
