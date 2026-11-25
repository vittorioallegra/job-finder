import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "./Button";

export interface ModalProps {
  title: string;
  closeLabel: string;
  children: ReactNode;
  /** Buttons at the bottom, next to the close button. */
  footer?: ReactNode;
  onClose: () => void;
}

/**
 * A large dialog over the screen, for a task that needs room (reading a preview, editing text).
 * Escape or a click outside closes it; focus goes to the close button and returns to the opener.
 * It stacks above a drawer, and Escape closes only the dialog.
 */
export function Modal({ title, closeLabel, children, footer, onClose }: ModalProps) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
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
      <div aria-hidden="true" className="absolute inset-0 bg-app-ink/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-full w-full max-w-3xl flex-col rounded-2xl border border-app-border bg-app-bg shadow-pop"
      >
        <div className="flex items-center justify-between gap-3 border-b border-app-border px-6 py-4">
          <h2 className="font-display text-xl font-semibold text-app-fg">{title}</h2>
          <Button
            ref={closeButton}
            variant="ghost"
            size="sm"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-app-border px-6 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
