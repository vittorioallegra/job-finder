import { BrowserWindow, shell } from "electron";
import type { MainLanguage } from "./i18n";
import { createTranslator } from "./i18n";
import { originOf } from "./security/origin";

export interface WindowOptions {
  preloadPath: string;
  /** Renderer entry: the Vite dev server in development, `app://renderer/` in production. */
  rendererUrl: string;
  language: MainLanguage;
  /** False keeps the window hidden when it is ready, for a start at login that stays in the tray. */
  showWhenReady?: boolean;
}

/** Creates the single application window with the hardened web preferences. */
export function createMainWindow(options: WindowOptions): BrowserWindow {
  const t = createTranslator(options.language);
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    show: false,
    title: t("window.title"),
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !process.env["JOB_FINDER_E2E"],
    },
  });

  const allowedOrigin = originOf(options.rendererUrl);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (originOf(url) !== allowedOrigin) {
      event.preventDefault();
    }
  });
  if (options.showWhenReady !== false) {
    window.once("ready-to-show", () => window.show());
  }

  void window.loadURL(options.rendererUrl);
  return window;
}
