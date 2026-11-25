import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  nativeImage,
  powerMonitor,
  net,
  protocol,
  session,
  shell,
} from "electron";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { backfillLocationCountries, refreshCompanyCountries } from "./db/company-country";
import { openAppDatabase, resolveMigrationsFolder, type AppDatabase } from "./db/database";
import { executeDbCalls, reconcileInterruptedRuns } from "./db/operations";
import { scoringCandidateIds } from "./db/scoring-operations";
import { registerIpcHandlers } from "./ipc/handlers";
import { createAiConnectionService } from "./ai/connection";
import { createCvImportService } from "./profile/cv-import";
import { createIngestRepository } from "./ingest/repository";
import { createIngestionService } from "./ingest/service";
import { createDiscoveryService } from "./discovery/service";
import { createDirectoryJobStore } from "./ingest/directory-jobs";
import { companiesWithOffers, pruneOffProfileCompanies } from "./ingest/prune";
import { createProfileDiscovery } from "./discovery/from-profile";
import { createProfileRepository } from "./profile/repository";
import { createScoringService } from "./scoring/service";
import { createApplicationRepository } from "./applications/repository";
import { createApplicationExport } from "./applications/export";
import { createDocumentRepository } from "./documents/repository";
import { createDocumentService } from "./documents/service";
import { createAutofillService } from "./autofill/service";
import { createAutofillAi } from "./autofill/ai-fill";
import { documentLanguageFor } from "@job-finder/core/documents/language";
import { openApplyWindow } from "./autofill/electron-window";
import { documentFilePath } from "./documents/files";
import { createPdfRenderer } from "./documents/pdf";
import { openPdfWindow } from "./documents/pdf-window";
import { createUtilityProcessLauncher } from "./engine/launcher";
import { engineEnvironment, FIXTURE_BASE_URL_ENV } from "./engine/fixture-env";
import { createPageLoader } from "./page-loader/loader";
import { openPageWindow } from "./page-loader/electron-window";
import { startEngineSupervisor, type EngineSupervisor } from "./engine/supervisor";
import { createFileLogger } from "./logging/file-logger";
import { originOf } from "./security/origin";
import { createSecretStore, createSettingsSecretRows } from "./secrets/store";
import { readAiKey } from "./ai/keys";
import { createSettingsRepository } from "./settings/repository";
import { APP_HOST, APP_SCHEME, resolveAppRequest } from "./protocol/app-protocol";
import { INGEST_PROGRESS_CHANNEL } from "@job-finder/bridge";
import { createTranslator, resolveMainLanguage } from "./i18n";
import { buildContentSecurityPolicy } from "./security/csp";
import { createMainWindow } from "./window";
import {
  APP_OPEN_NEW_JOBS_CHANNEL,
  APP_STATUS_CHANNEL,
  type CloseBehavior,
} from "@job-finder/bridge";
import { createScheduler, type Scheduler } from "./scheduler/scheduler";
import { filterFromPreferences } from "@job-finder/core/filters";
import { findNewMatches } from "./scheduler/matches";
import { lastFinishedIngestRunAt } from "./scheduler/store";
import { createNewJobsNotifier, type NotificationSink } from "./notifications/new-jobs";
import { createOpenNewJobsRelay } from "./navigation/open-new-jobs";
import {
  closeAction,
  closeChoice,
  closeDialogOptions,
  rememberedBehavior,
  type CloseChoice,
} from "./lifecycle/close";
import { createTrayController, type TrayController } from "./tray/tray";
import { resolveTrayIconPath } from "./tray/icon";
import { createUpdateService, type UpdateService } from "./updates/update-service";
import { createAppStatusStore } from "./app-status";
import { applyLaunchAtLogin } from "./login-item";
import { demoDataDirectory, seedDemoDatabase } from "./demo/seed";

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

/** Matches `appId` in electron-builder.yml; Windows groups notifications and taskbar entries by it. */
const APP_USER_MODEL_ID = "dev.job-finder.desktop";
if (process.platform === "win32") {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

// Development demo (JOB_FINDER_DEMO=1): sample data in a userData folder of its own.
const demoDirectory = demoDataDirectory(process.env, app.isPackaged, app.getPath("userData"));
if (demoDirectory) {
  app.setPath("userData", demoDirectory);
}

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
    if (demoDirectory && (await seedDemoDatabase(database.db))) {
      logger.log("info", `demo data written to ${demoDirectory}`);
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
    const ingestRepository = createIngestRepository(database.db);
    let quitting = false;
    let closePromptOpen = false;
    let tray: TrayController | null = null;
    let scheduler: Scheduler | null = null;
    // Status goes to every window and to the tray; the engine and the update check feed it.
    const appStatus = createAppStatusStore({ engine: "running", update: null }, (status) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(APP_STATUS_CHANNEL, status);
      }
      tray?.update(status);
    });
    app.on("before-quit", () => {
      quitting = true;
    });
    await backfillLocationCountries(database.db)
      .then(() => refreshCompanyCountries(database.db))
      .catch((error: unknown) =>
        logger.log("warn", `could not refresh company countries: ${String(error)}`),
      );
    const secretRows = createSettingsSecretRows(database.db);
    const secretStore = createSecretStore({ rows: secretRows });
    let supervisor: EngineSupervisor | null = null;
    const ingestion = createIngestionService({
      onBoardGone: (companyId) => {
        void ingestRepository.removeCompany(companyId, undefined, "gone").then(
          () => logger.log("info", `removed company ${companyId}: its board no longer exists`),
          (error: unknown) =>
            logger.log("warn", `could not remove company ${companyId}: ${String(error)}`),
        );
      },
      onRunFinished: (runId, status) => {
        // The scan changed the jobs, so the companies' countries are read again before the
        // scheduler counts the new matches (which depend on them).
        void refreshCompanyCountries(database.db)
          .then(() => pruneNow())
          .catch((error: unknown) =>
            logger.log("warn", `could not refresh company countries: ${String(error)}`),
          )
          .then(() => scheduler?.handleRunFinished(runId, status));
      },
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
            apiKey: await readAiKey(secretStore, ai),
          },
          contextSize: ai.contextSize,
        };
      },
    });
    supervisor = startEngineSupervisor({
      onStateChange: (state) => appStatus.setEngine(state),
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
    const updates: UpdateService = createUpdateService({
      engine: () => supervisor,
      currentVersion: app.getVersion(),
      // Under the E2E harness without a fixture, the check stays off: a test never reaches GitHub.
      enabled: async () => {
        const blocked =
          Boolean(process.env["JOB_FINDER_E2E"]) &&
          !engineEnvironment(process.env, app.isPackaged)[FIXTURE_BASE_URL_ENV];
        return !blocked && (await settingsRepository.get()).updates.checkEnabled;
      },
      now: () => Date.now(),
      onChange: (notice) => appStatus.setUpdate(notice),
      log: (level, message) => logger.log(level, message),
    });
    const ticker = setInterval(() => {
      void scheduler?.check();
      void updates.checkIfDue();
    }, 60_000);
    powerMonitor.on("resume", () => {
      void scheduler?.check();
      void updates.checkIfDue();
    });
    app.on("will-quit", () => {
      clearInterval(ticker);
      tray?.destroy();
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
    /** Drops the companies a search added that have nothing for the profile's places. */
    const pruneNow = async (): Promise<void> => {
      const preferences = (await profileRepository.get())?.profile.preferences ?? null;
      const dropped = await pruneOffProfileCompanies(database.db, preferences);
      if (dropped > 0)
        logger.log("info", `dropped ${dropped} companies with no job in the profile's places`);
    };
    void pruneNow().catch((error: unknown) =>
      logger.log("warn", `could not drop off-profile companies: ${String(error)}`),
    );
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
        scoringCandidateIds(database.db, filter, preferredIds, limit),
      systemLocale: () => app.getLocale(),
    });
    const documentsRoot = join(userData, "applications");
    const uploadsRoot = join(app.getPath("temp"), "job-finder-uploads");
    const applicationRepository = createApplicationRepository(database.db, (applicationId) =>
      rm(join(documentsRoot, applicationId), { recursive: true, force: true }),
    );
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
    const documentRepository = createDocumentRepository(database.db);
    const documents = createDocumentService({
      repository: documentRepository,
      profile: profileRepository,
      settings: settingsRepository,
      secrets: secretStore,
      engine: supervisor,
      renderPdf: createPdfRenderer({ openWindow: openPdfWindow }),
      chooseFile: async (defaultName) => {
        const result = await dialog.showSaveDialog({
          title: t("documents.export.dialogTitle"),
          defaultPath: defaultName,
          filters: [{ name: t("documents.export.filterName"), extensions: ["pdf"] }],
        });
        return result.canceled || result.filePath === undefined ? null : result.filePath;
      },
      writeFile: (path, bytes) => writeFile(path, bytes),
      systemLocale: () => app.getLocale(),
    });
    const autofill = createAutofillService({
      applications: applicationRepository,
      profile: profileRepository,
      documentFile: async (applicationId, kind) => {
        // The form gets a fresh PDF made now; it lives in the temp folder, not in the app's data.
        const file = await documents.pdfFile(applicationId, kind);
        if (file === null) return null;
        const folder = dirname(documentFilePath(uploadsRoot, applicationId, kind));
        await mkdir(folder, { recursive: true });
        const path = join(folder, file.fileName);
        await writeFile(path, file.bytes);
        return path;
      },
      openWindow: openApplyWindow,
      ai: createAutofillAi({
        settings: settingsRepository,
        secrets: secretStore,
        engine: supervisor,
        language: async (applicationId) => {
          const posting = await documentRepository.jobOf(applicationId);
          return documentLanguageFor(posting?.language).language;
        },
      }),
    });
    const directoryJobStore = createDirectoryJobStore(database.db);
    const discovery = createDiscoveryService({
      engine: () => supervisor,
      settings: settingsRepository,
      secrets: secretStore,
      knownBoards: async () =>
        (await ingestRepository.listCompanies()).flatMap((company) =>
          company.ats !== null && company.slug !== null ? [`${company.ats}/${company.slug}`] : [],
        ),
      wideCursor: directoryJobStore.wideCursor,
      wideChecked: directoryJobStore.wideChecked,
      storeJobs: async (postings) => {
        const stored = await directoryJobStore.store(postings);
        await refreshCompanyCountries(database.db);
        return stored;
      },
      knownHosts: async () =>
        (await ingestRepository.listCompanies()).flatMap((company) => {
          try {
            return [new URL(company.careersUrl).hostname];
          } catch {
            return [];
          }
        }),
    });
    const profileDiscovery = createProfileDiscovery({
      preferences: async () => (await profileRepository.get())?.profile.preferences ?? null,
      search: (request) => discovery.search(request),
      widen: (request) => discovery.widen(request),
      addCompany: (input) => ingestRepository.addCompany(input),
      startRun: () => ingestion.start(),
    });
    /** Creates the main window, or shows the existing one (also from the tray and a notification). */
    function showMainWindow(): void {
      if (!mainWindow || mainWindow.isDestroyed()) {
        mainWindow = openWindow(true);
        return;
      }
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }

    function openWindow(showWhenReady: boolean): BrowserWindow {
      const window = createMainWindow({ preloadPath, rendererUrl, language, showWhenReady });
      attachCloseHandling(window);
      return window;
    }

    /** The close button follows the saved choice; "ask" shows the prompt, which can remember the answer. */
    function attachCloseHandling(window: BrowserWindow): void {
      window.on("close", (event) => {
        if (quitting) return;
        event.preventDefault();
        void handleCloseRequest(window);
      });
    }

    async function handleCloseRequest(window: BrowserWindow): Promise<void> {
      if (closePromptOpen) return;
      let saved: CloseBehavior = "ask";
      try {
        saved = (await settingsRepository.get()).app.closeBehavior;
      } catch {
        logger.log("warn", "close behaviour unreadable; asking");
      }
      const action = closeAction(saved);
      let choice: CloseChoice = action === "prompt" ? "cancel" : action;
      if (action === "prompt") {
        closePromptOpen = true;
        try {
          const answer = await dialog.showMessageBox(window, closeDialogOptions(t));
          choice = closeChoice(answer.response);
          const remembered = rememberedBehavior(choice, answer.checkboxChecked);
          if (remembered) {
            await settingsRepository.update({ app: { closeBehavior: remembered } });
          }
        } finally {
          closePromptOpen = false;
        }
      }
      if (choice === "cancel") return;
      if (choice === "keep-running") {
        window.hide();
        return;
      }
      quitting = true;
      app.quit();
    }

    // A notification click waits here until a window has taken it (the window may be hidden or loading).
    const openNewJobs = createOpenNewJobsRelay((request) => {
      showMainWindow();
      mainWindow?.webContents.send(APP_OPEN_NEW_JOBS_CHANNEL, request);
    });
    const liveNotifications = new Set<Notification>();
    const notificationSink: NotificationSink = {
      // Notifications stay off under the E2E harness, which must not raise OS messages.
      isSupported: () => !process.env["JOB_FINDER_E2E"] && Notification.isSupported(),
      show: ({ title, body }, onClick) => {
        const notification = new Notification({ title, body });
        liveNotifications.add(notification);
        notification.on("click", onClick);
        notification.on("close", () => liveNotifications.delete(notification));
        notification.show();
      },
    };
    const notifyNewJobs = createNewJobsNotifier({
      translate: t,
      sink: notificationSink,
      open: (request) => openNewJobs.open(request),
    });
    // The demo never scans on a schedule: its companies and postings are made up.
    scheduler = demoDirectory
      ? null
      : createScheduler({
          now: () => Date.now(),
          settings: async () => {
            const stored = await settingsRepository.get();
            return {
              intervalHours: stored.scheduler.intervalHours,
              notificationsEnabled: stored.notifications.enabled,
            };
          },
          hasPreferences: async () =>
            ((await profileRepository.get())?.profile.preferences.roles.length ?? 0) > 0,
          discover: async () => {
            const result = await profileDiscovery.run({ scan: false });
            if (!result.ok && result.code !== "no-roles") {
              logger.log("warn", `scheduled company search failed: ${result.code}`);
            }
          },
          lastRunFinishedAt: () => lastFinishedIngestRunAt(database.db),
          startRun: () => ingestion.start(),
          newMatches: async (since) =>
            findNewMatches(
              filterFromPreferences((await profileRepository.get())?.profile.preferences ?? null),
              since,
              (filter) => ingestRepository.listJobs({ filter, sort: "newest" }, 500),
            ),
          notify: notifyNewJobs,
          log: (level, message) => logger.log(level, message),
        });

    registerIpcHandlers(
      ipcMain,
      {
        app: {
          status: () => appStatus.get(),
          openUpdate: async () => {
            const notice = updates.notice();
            // Only the release page of this repository is opened, never a URL the engine supplied.
            if (!notice?.url.startsWith("https://github.com/")) return false;
            await shell.openExternal(notice.url);
            return true;
          },
          takePendingOpen: () => openNewJobs.take(),
        },
        afterSettingsUpdate: (next) => {
          try {
            applyLaunchAtLogin(next.app.launchAtLogin, {
              platform: process.platform,
              isPackaged: app.isPackaged,
              setOpenAtLogin: (openAtLogin) => app.setLoginItemSettings({ openAtLogin }),
            });
          } catch (error) {
            logger.log("error", `launch at login not applied: ${String(error)}`);
          }
          if (next.updates.checkEnabled) {
            void updates.checkIfDue();
          } else {
            void updates.check();
          }
        },
        settings: settingsRepository,
        secrets: secretStore,
        ai: aiConnection,
        profile: profileRepository,
        cvImport,
        repository: ingestRepository,
        companySummary: async () => ({
          withOffers: await companiesWithOffers(
            database.db,
            (await profileRepository.get())?.profile.preferences ?? null,
          ),
        }),
        ingestion,
        discovery,
        profileDiscovery,
        scoring,
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
      const stored = await settingsRepository.get();
      // A start at login stays in the tray; the window stays hidden until the user opens it.
      const startedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin === true;
      mainWindow = openWindow(!(startedAtLogin && stored.app.closeBehavior !== "quit"));
      applyLaunchAtLogin(stored.app.launchAtLogin, {
        platform: process.platform,
        isPackaged: app.isPackaged,
        setOpenAtLogin: (openAtLogin) => app.setLoginItemSettings({ openAtLogin }),
      });
    } catch (error) {
      logger.log("error", `window creation failed: ${String(error)}`);
      dialog.showErrorBox(t("startup.failedTitle"), t("startup.failedBody"));
      app.quit();
    }

    try {
      tray = createTrayController({
        icon: nativeImage
          .createFromPath(
            resolveTrayIconPath({
              isPackaged: app.isPackaged,
              resourcesPath: process.resourcesPath,
              appRoot: resolve(__dirname, "../.."),
            }),
          )
          .resize({ width: 18, height: 18 }),
        translate: t,
        initial: appStatus.get(),
        actions: {
          open: showMainWindow,
          searchNow: () => {
            void scheduler?.runNow().then((outcome) => {
              if (!outcome.ok)
                logger.log("warn", `search from the tray not started: ${outcome.code}`);
            });
          },
          quit: () => app.quit(),
        },
      });
    } catch (error) {
      logger.log("error", `tray unavailable: ${String(error)}`);
    }

    // Catch-up at start: a scheduled run that is due runs once now. The update check runs once a day.
    void scheduler?.check();
    void updates.checkIfDue();

    app.on("activate", showMainWindow);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
