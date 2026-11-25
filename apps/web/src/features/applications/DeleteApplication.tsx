import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { Button } from "../../components/ui/Button";

interface DeleteApplicationProps {
  title: string;
  /** Deletes the application. The caller shows a failure. */
  onDelete: () => Promise<void>;
}

/** A delete button that asks once, in place, before it deletes. */
export function DeleteApplication({ title, onDelete }: DeleteApplicationProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!confirming) {
    return (
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("applications.delete.button", { title })}
        onClick={() => setConfirming(true)}
      >
        <Trash2 className="size-4" strokeWidth={1.8} aria-hidden="true" />
        {t("applications.delete.label")}
      </Button>
    );
  }
  return (
    <div role="group" aria-label={title} className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-app-fg">{t("applications.delete.confirm")}</span>
      <Button
        variant="danger"
        size="sm"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void onDelete().finally(() => {
            setBusy(false);
            setConfirming(false);
          });
        }}
      >
        {t("applications.delete.yes")}
      </Button>
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
        {t("applications.delete.cancel")}
      </Button>
    </div>
  );
}
