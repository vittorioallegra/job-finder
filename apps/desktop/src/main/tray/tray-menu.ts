import type { AppStatus } from "@job-finder/bridge";
import type { Translate } from "../i18n";

/** One entry of the tray menu, as Electron's menu template reads it. */
export interface TrayMenuEntry {
  label?: string;
  type?: "separator";
  enabled?: boolean;
  click?: () => void;
}

export interface TrayActions {
  open: () => void;
  searchNow: () => void;
  quit: () => void;
}

/** The tray menu for the current status: Open, Search now, the update and engine notices, Quit. */
export function trayMenuEntries(
  t: Translate,
  status: AppStatus,
  actions: TrayActions,
): TrayMenuEntry[] {
  const entries: TrayMenuEntry[] = [
    { label: t("tray.open"), click: actions.open },
    {
      label: t("tray.searchNow"),
      enabled: status.engine === "running",
      click: actions.searchNow,
    },
  ];
  const notices: TrayMenuEntry[] = [];
  if (status.update) {
    notices.push({
      label: t("tray.updateAvailable", { version: status.update.version }),
      click: actions.open,
    });
  }
  if (status.engine === "failed") {
    notices.push({ label: t("tray.engineFailed"), enabled: false });
  }
  if (notices.length > 0) {
    entries.push({ type: "separator" }, ...notices);
  }
  entries.push({ type: "separator" }, { label: t("tray.quit"), click: actions.quit });
  return entries;
}

/** The tooltip names the app and, when the engine has stopped, says so. */
export function trayTooltip(t: Translate, status: AppStatus): string {
  return status.engine === "failed"
    ? `${t("tray.tooltip")}: ${t("tray.engineFailed")}`
    : t("tray.tooltip");
}
