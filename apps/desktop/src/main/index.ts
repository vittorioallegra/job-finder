import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  net,
  protocol,
  session,
  shell,
} from "electron";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { openAppDatabase, resolveMigrationsFolder, type AppDatabase } from "./db/database";
import { executeDbCalls, reconcileInterruptedRuns } from "./db/operations";
import { scoringCandidateIds } from "./db/scoring-operations";
import { registerIpcHandlers } from "./ipc/handlers";
import { createAiConnectionService } from "./ai/connection";
import { createCvImportService } from "./profile/cv-import";
import { createIngestRepository } from "./ingest/repository";
import { createIngestionService } from "./ingest/service";
import { createDiscoveryService } from "./discovery/service";
import { createProfileRepository } from "./profile/repository";
import { createScoringService } from "./scoring/service";
import { createSavedSearchRepository } from "./saved-searches/repository";
import { createApplicationRepository } from "./applications/repository";
import { createApplicationExport } from "./applications/export";
import { createDocumentRepository } from "./documents/repository";
import { createDocumentService } from "./documents/service";
import { createAutofillService } from "./autofill/service";
import { createAutofillAi } from "./autofill/ai-fill";
import { documentLanguageFor } from "@job-finder/core/documents/language";
import { explanationLanguage } from "./scoring/service";
import { openApplyWindow } from "./autofill/electron-window";
import { documentFilePath } from "./documents/files";
import { createPdfRenderer } from "./documents/pdf";
import { openPdfWindow } from "./documents/pdf-window";
import { createUtilityProcessLauncher } from "./engine/launcher";
import { engineEnvironment } from "./engine/fixture-env";
import { createPageLoader } from "./page-loader/loader";
import { openPageWindow } from "./page-loader/electron-window";
import { startEngineSupervisor, type EngineSupervisor } from "./engine/supervisor";
import { createFileLogger } from "./logging/file-logger";
import { originOf } from "./security/origin";
import { createSecretStore, createSettingsSecretRows } from "./secrets/store";
import { createSettingsRepository } from "./settings/repository";
import { APP_HOST, APP_SCHEME, resolveAppRequest } from "./protocol/app-protocol";
import { INGEST_PROGRESS_CHANNEL } from "@job-finder/bridge";
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
    // The ingestion service and the supervisor refer to each other: the supervisor forwards engine
    // progress to the service, and the service reaches the engine through `supervisor`.
    const settingsRepository = createSettingsRepository(database.db);
    const secretStore = createSecretStore({
      safeStorage,
      rows: createSettingsSecretRows(database.db),
      isBasicTextAllowed: async () => (await settingsRepository.get()).secrets.allowBasicText,
    });
    let supervisor: EngineSupervisor | null = null;
    const ingestion = createIngestionService({
      engine: () => supervisor,
      broadcast: (event) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send(INGEST_PROGRESS_CHANNEL, event);
        }
      },
      // Generic careers pages use the saved AI provider; the key is read here and handed only to the engine.
      aiSettings: async () => {
        const { ai } = await settingsRepository.get();
        return {
          config: {
            provider: ai.provider,
            model: ai.model,
            baseUrl: ai.baseUrl,
            apiKey: await secretStore.read("ai.apiKey"),
          },
          contextSize: ai.contextSize,
        };
      },
    });
    supervisor = startEngineSupervisor({
      launch: createUtilityProcessLauncher(
        enginePath,
        engineEnvironment(process.env, app.isPackaged),
      ),
      database: {
        execute: (calls) => executeDbCalls(database.db, calls),
        reconcileInterruptedRuns: () => reconcileInterruptedRuns(database.db),
      },
      pages: createPageLoader({ openWindow: openPageWindow }),
      log: (level, message) => logger.log(level, message),
      onIngestEvent: (event) => ingestion.handleEngineEvent(event),
      onEngineLost: () => ingestion.handleEngineLost(),
    });
    app.on("will-quit", () => {
      supervisor?.stop();
      database.close();
    });

    const rendererUrl = isDevelopment
      ? (process.env["ELECTRON_RENDERER_URL"] as string)
      : `${APP_SCHEME}://${APP_HOST}/`;
    const aiConnection = createAiConnectionService({
      settings: settingsRepository,
      secrets: secretStore,
      engine: supervisor,
    });
    const profileRepository = createProfileRepository(database.db);
    const ingestRepository = createIngestRepository(database.db);
    const cvImport = createCvImportService({
      settings: settingsRepository,
      secrets: secretStore,
      engine: supervisor,
    });
    const scoring = createScoringService({
      engine: supervisor,
      profile: profileRepository,
      settings: settingsRepository,
      secrets: secretStore,
      candidateIds: (filter, preferredIds, limit) =>
        scoringCandidateIds(database.db, filter, preferredIds, Date.now(), limit),
      systemLocale: () => app.getLocale(),
    });
    const applicationRepository = createApplicationRepository(database.db);
    const applicationExport = createApplicationExport({
      repository: applicationRepository,
      chooseFile: async (defaultName) => {
        const result = await dialog.showSaveDialog({
          title: t("applications.export.dialogTitle"),
          defaultPath: defaultName,
          filters: [{ name: t("applications.export.filterName"), extensions: ["csv"] }],
        });
        return result.canceled || result.filePath === undefined ? null : result.filePath;
      },
      writeFile: (path, content) => writeFile(path, content, "utf8"),
    });
    const documentsRoot = join(userData, "applications");
    const documentRepository = createDocumentRepository(database.db);
    const documents = createDocumentService({
      repository: documentRepository,
      profile: profileRepository,
      settings: settingsRepository,
      secrets: secretStore,
      engine: supervisor,
      renderPdf: createPdfRenderer({ openWindow: openPdfWindow }),
      writePdf: async (applicationId, kind, bytes) => {
        const path = documentFilePath(documentsRoot, applicationId, kind);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, bytes);
      },
      pdfPath: (applicationId, kind) => documentFilePath(documentsRoot, applicationId, kind),
      revealPath: (path) => {
        shell.showItemInFolder(path);
      },
      systemLocale: () => app.getLocale(),
    });
    const autofill = createAutofillService({
      applications: applicationRepository,
      profile: profileRepository,
      documentExists: (applicationId, kind) =>
        existsSync(documentFilePath(documentsRoot, applicationId, kind)),
      documentPath: (applicationId, kind) => documentFilePath(documentsRoot, applicationId, kind),
      openWindow: openApplyWindow,
      ai: createAutofillAi({
        settings: settingsRepository,
        secrets: secretStore,
        engine: supervisor,
        language: async (applicationId) => {
          const posting = await documentRepository.jobOf(applicationId);
          const { ui } = await settingsRepository.get();
          const uiLanguage = explanationLanguage(ui.language, app.getLocale());
          return documentLanguageFor(posting?.language, uiLanguage).language;
        },
      }),
    });
    const discovery = createDiscoveryService({
      engine: () => supervisor,
      settings: settingsRepository,
      secrets: secretStore,
    });
    registerIpcHandlers(
      ipcMain,
      {
        settings: settingsRepository,
        secrets: secretStore,
        ai: aiConnection,
        profile: profileRepository,
        cvImport,
        repository: ingestRepository,
        ingestion,
        discovery,
        scoring,
        savedSearches: createSavedSearchRepository(database.db),
        applications: applicationRepository,
        applicationExport,
        documents,
        autofill,
      },
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
