import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";

interface DeleteApplicationProps {
  title: string;
  /** Deletes the application. The caller shows a failure. */
  onDelete: () => Promise<void>;
}

/** A red delete button that opens a dialog and deletes only after the user confirms there. */
export function DeleteApplication({ title, onDelete }: DeleteApplicationProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <Button
        variant="destructive"
        size="sm"
        aria-label={t("applications.delete.button", { title })}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-4" strokeWidth={1.8} aria-hidden="true" />
        {t("applications.delete.label")}
      </Button>
      {open ? (
        <ConfirmDialog
          title={t("applications.delete.title", { title })}
          confirmLabel={t("applications.delete.yes")}
          cancelLabel={t("applications.delete.cancel")}
          danger
          busy={busy}
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            setBusy(true);
            void onDelete().finally(() => {
              setBusy(false);
              setOpen(false);
            });
          }}
        >
          {t("applications.delete.confirm")}
        </ConfirmDialog>
      ) : null}
    </>
  );
}
