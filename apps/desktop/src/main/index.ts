import { app, BrowserWindow, dialog, ipcMain, safeStorage, net, protocol, session } from "electron";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openAppDatabase, resolveMigrationsFolder, type AppDatabase } from "./db/database";
import { executeDbCalls, reconcileInterruptedRuns } from "./db/operations";
import { registerIpcHandlers } from "./ipc/handlers";
import { createUtilityProcessLauncher } from "./engine/launcher";
import { startEngineSupervisor } from "./engine/supervisor";
import { createFileLogger } from "./logging/file-logger";
import { originOf } from "./security/origin";
import { createSecretStore, createSettingsSecretRows } from "./secrets/store";
import { createSettingsRepository } from "./settings/repository";
import { APP_HOST, APP_SCHEME, resolveAppRequest } from "./protocol/app-protocol";
import { createTranslator, resolveMainLanguage } from "./i18n";
import { buildContentSecurityPolicy } from "./security/csp";
import { createMainWindow } from "./window";

const isDevelopment = !app.isPackaged && Boolean(process.env["ELECTRON_RENDERER_URL"]);
const rendererDirectory = join(__dirname, "../renderer");
const preloadPath = join(__dirname, "../preload/index.js");
const enginePath = join(__dirname, "engine.js");

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

  void app.whenReady().then(async () => {
    const userData = app.getPath("userData");
    const logger = createFileLogger({ directory: join(userData, "logs") });
    const language = resolveMainLanguage(app.getLocale());
    const t = createTranslator(language);
    logger.log("info", `starting job-finder ${app.getVersion()} on ${process.platform}`);

    let database: AppDatabase;
    try {
      database = await openAppDatabase({
        file: join(userData, "job-finder.sqlite"),
        migrationsFolder: resolveMigrationsFolder({
          isPackaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
          appRoot: resolve(__dirname, "../.."),
        }),
        backupDirectory: join(userData, "backups"),
      });
    } catch (error) {
      logger.log("error", `database startup failed: ${String(error)}`);
      dialog.showErrorBox(t("startup.failedTitle"), t("startup.databaseFailedBody"));
      app.quit();
      return;
    }
    if (database.migration.pending > 0) {
      logger.log(
        "info",
        `applied ${database.migration.pending} migration(s); backup: ${database.migration.backupPath ?? "none"}`,
      );
    }
    const interrupted = await reconcileInterruptedRuns(database.db);
    if (interrupted > 0) {
      logger.log(
        "warn",
        `${interrupted} run(s) left running by a previous session marked interrupted`,
      );
    }
    const supervisor = startEngineSupervisor({
      launch: createUtilityProcessLauncher(enginePath),
      database: {
        execute: (calls) => executeDbCalls(database.db, calls),
        reconcileInterruptedRuns: () => reconcileInterruptedRuns(database.db),
      },
      log: (level, message) => logger.log(level, message),
    });
    app.on("will-quit", () => {
      supervisor.stop();
      database.close();
    });

    const rendererUrl = isDevelopment
      ? (process.env["ELECTRON_RENDERER_URL"] as string)
      : `${APP_SCHEME}://${APP_HOST}/`;
    const settingsRepository = createSettingsRepository(database.db);
    const secretStore = createSecretStore({
      safeStorage,
      rows: createSettingsSecretRows(database.db),
      isBasicTextAllowed: async () => (await settingsRepository.get()).secrets.allowBasicText,
    });
    registerIpcHandlers(
      ipcMain,
      { settings: settingsRepository, secrets: secretStore },
      originOf(rendererUrl) ?? rendererUrl,
    );

    try {
      registerAppProtocol();
      applySecurityPolicy();
      mainWindow = createMainWindow({ preloadPath, rendererUrl, language });
    } catch (error) {
      logger.log("error", `window creation failed: ${String(error)}`);
      dialog.showErrorBox(t("startup.failedTitle"), t("startup.failedBody"));
      app.quit();
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow({ preloadPath, rendererUrl, language });
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
