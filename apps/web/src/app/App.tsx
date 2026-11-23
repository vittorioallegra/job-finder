import { useEffect } from "react";
import { RouterProvider } from "react-router";
import { BridgeProvider, useBridge } from "../lib/bridge/BridgeContext";
import { i18n, resolveUiLanguage } from "../lib/i18n";
import { router } from "./router";

export function App() {
  return (
    <BridgeProvider>
      <LanguageSync />
      <RouterProvider router={router} />
    </BridgeProvider>
  );
}

/**
 * Applies the saved UI language once at startup. If settings cannot be read, the browser language
 * stays in effect, so the app still renders.
 */
function LanguageSync() {
  const bridge = useBridge();
  useEffect(() => {
    let active = true;
    bridge.settings
      .get()
      .then((settings) => {
        if (active) {
          void i18n.changeLanguage(resolveUiLanguage(settings.ui.language));
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [bridge]);
  return null;
}
