import { useEffect, useRef } from "react";

/** How long a confirmation such as "Settings saved." stays on screen. */
export const CONFIRMATION_MS = 4000;

/**
 * Clears a confirmation a few seconds after it appears: calls `clear` once `shown` has been true
 * for `ms`. A new confirmation, or the message going away first, starts the wait again.
 */
export function useAutoDismiss(shown: boolean, clear: () => void, ms = CONFIRMATION_MS): void {
  const clearRef = useRef(clear);
  useEffect(() => {
    clearRef.current = clear;
  });
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => clearRef.current(), ms);
    return () => clearTimeout(timer);
  }, [shown, ms]);
}
