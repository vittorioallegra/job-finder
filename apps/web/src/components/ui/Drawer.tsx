import { useEffect, useRef, type ReactNode } from "react";

export interface DrawerProps {
  /** Accessible name of the dialog. */
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Side panel over the current screen. Escape or a click on the backdrop closes it; focus moves into
 * the panel when it opens and back to the element that opened it when it closes.
 */
export function Drawer({ label, onClose, children }: DrawerProps) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close.current();
    }
    document.addEventListener("keydown", onKey);
    // The page behind stays still: only the panel scrolls.
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-app-ink/25 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="relative h-full w-full max-w-2xl overflow-y-auto overscroll-contain border-l border-app-border bg-app-bg p-6 shadow-pop outline-none sm:p-8"
      >
        {children}
      </div>
    </div>
  );
}
