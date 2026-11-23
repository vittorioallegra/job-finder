import { Menu, Tray, type NativeImage, type MenuItemConstructorOptions } from "electron";
import type { AppStatus } from "@job-finder/bridge";
import type { Translate } from "../i18n";
import { trayMenuEntries, trayTooltip, type TrayActions } from "./tray-menu";

export interface TrayController {
  /** Redraws the tooltip and the menu for the status. */
  update(status: AppStatus): void;
  destroy(): void;
}

/** The tray (Windows, Linux) or menu-bar (macOS) icon. Its menu is rebuilt from the status model. */
export function createTrayController(options: {
  icon: NativeImage;
  translate: Translate;
  actions: TrayActions;
  initial: AppStatus;
}): TrayController {
  const tray = new Tray(options.icon);
  const render = (status: AppStatus) => {
    tray.setToolTip(trayTooltip(options.translate, status));
    const template: MenuItemConstructorOptions[] = trayMenuEntries(
      options.translate,
      status,
      options.actions,
    ).map((entry) =>
      entry.type === "separator"
        ? { type: "separator" }
        : { label: entry.label, enabled: entry.enabled ?? true, click: entry.click },
    );
    tray.setContextMenu(Menu.buildFromTemplate(template));
  };
  render(options.initial);
  tray.on("click", options.actions.open);
  return {
    update: render,
    destroy: () => tray.destroy(),
  };
}
