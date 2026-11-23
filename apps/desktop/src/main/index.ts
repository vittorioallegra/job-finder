import { app, BrowserWindow, dialog, net, protocol, session } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createFileLogger } from "./logging/file-logger";
import { APP_HOST, APP_SCHEME, resolveAppRequest } from "./protocol/app-protocol";
import { createTranslator, resolveMainLanguage } from "./i18n";
import { buildContentSecurityPolicy } from "./security/csp";
import { createMainWindow } from "./window";

const isDevelopment = !app.isPackaged && Boolean(process.env["ELECTRON_RENDERER_URL"]);
const rendererDirectory = join(__dirname, "../renderer");
const preloadPath = join(__dirname, "../preload/index.js");

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false },
  },
]);

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function registerAppProtocol(): void {
  protocol.handle(APP_SCHEME, (request) => {
    const filePath = resolveAppRequest(rendererDirectory, request.url);
    if (!filePath || !existsSync(filePath)) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function applySecurityPolicy(): void {
  const csp = buildContentSecurityPolicy({ development: isDevelopment });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [csp] },
    });
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

if (gotSingleInstanceLock) {
  app.on("second-instance", focusMainWindow);

  void app.whenReady().then(() => {
    const logger = createFileLogger({ directory: join(app.getPath("userData"), "logs") });
    const language = resolveMainLanguage(app.getLocale());
    const t = createTranslator(language);
    logger.log("info", `starting job-finder ${app.getVersion()} on ${process.platform}`);

    try {
      registerAppProtocol();
      applySecurityPolicy();
      const rendererUrl = isDevelopment
        ? (process.env["ELECTRON_RENDERER_URL"] as string)
        : `${APP_SCHEME}://${APP_HOST}/`;
      mainWindow = createMainWindow({ preloadPath, rendererUrl, language });
    } catch (error) {
      logger.log("error", `window creation failed: ${String(error)}`);
      dialog.showErrorBox(t("startup.failedTitle"), t("startup.failedBody"));
      app.quit();
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow({
          preloadPath,
          rendererUrl: isDevelopment
            ? (process.env["ELECTRON_RENDERER_URL"] as string)
            : `${APP_SCHEME}://${APP_HOST}/`,
          language,
        });
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
