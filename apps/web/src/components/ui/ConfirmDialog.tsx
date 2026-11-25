import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

export interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  /** The confirm button is red: the action cannot be undone. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A small modal that asks before an action. Escape or a click outside cancels; focus starts on the
 * cancel button and returns to the opener afterwards. It stacks above a drawer.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancel = useRef<HTMLButtonElement>(null);
  const close = useRef(onCancel);
  useEffect(() => {
    close.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancel.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // The drawer below listens for Escape too: only this dialog closes.
      event.stopPropagation();
      close.current();
    }
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      opener?.focus();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div aria-hidden="true" className="absolute inset-0 bg-app-ink/40" onClick={onCancel} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex w-full max-w-md flex-col gap-4 rounded-2xl border border-app-border bg-app-bg p-6 shadow-pop"
      >
        <h2 className="font-display text-xl font-semibold text-app-fg">{title}</h2>
        <div className="text-sm text-app-muted">{children}</div>
        <div className="flex justify-end gap-2">
          <Button ref={cancel} variant="secondary" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "destructive" : "primary"} disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
