// protects=the packaged app opens its window, the engine reports ready after a ping, migrations run from resources/drizzle, and the main process reads the database with node:sqlite;
// fails_when=the packaged executable does not open a window, the engine never reports ready, no migration is applied, the migrations folder is not under resources, or node:sqlite cannot read the migrations table;
// no_claim=installer contents and the shipped inspector fuse are not checked here (only the copy used for the run has the inspector fuse on); code signing and the unpacked dev build are covered elsewhere.
import { _electron as electron, expect, test } from "@playwright/test";
import { FuseV1Options, FuseVersion, flipFuses } from "@electron/fuses";
import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";

// Set by the release workflow and by `pnpm --filter @job-finder/desktop test:e2e:packaged`.
const executablePath = process.env["JOB_FINDER_PACKAGED_APP"];

/**
 * Playwright attaches to Electron through the Node inspector (`--inspect=0`), which the release
 * build disables with a fuse. The test runs a copy of the packaged app with only that fuse turned
 * back on; everything else (asar, resources, migrations, binary) is the shipped build.
 */
async function copyWithInspectorEnabled(executable: string): Promise<string> {
  const isMac = process.platform === "darwin";
  const appRoot = isMac ? dirname(dirname(dirname(executable))) : dirname(executable);
  const copyRoot = mkdtempSync(join(tmpdir(), "job-finder-packaged-app-"));
  const copiedRoot = join(copyRoot, basename(appRoot));
  cpSync(appRoot, copiedRoot, { recursive: true, verbatimSymlinks: true });
  const copiedExecutable = join(copiedRoot, relative(appRoot, executable));
  await flipFuses(isMac ? copiedRoot : copiedExecutable, {
    version: FuseVersion.V1,
    [FuseV1Options.EnableNodeCliInspectArguments]: true,
    resetAdHocDarwinSignature: isMac,
  });
  return copiedExecutable;
}

test.describe("packaged app", () => {
  test.skip(!executablePath, "set JOB_FINDER_PACKAGED_APP to the packaged executable");

  test("engine is ready, migrations ran from resources and node:sqlite reads the database", async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "job-finder-packaged-"));
    const launchable = await copyWithInspectorEnabled(executablePath as string);
    // CI on Linux runners cannot start Chromium's sandbox; the workflow sets this to opt out.
    const args = [`--user-data-dir=${userDataDir}`];
    if (process.env["JOB_FINDER_E2E_NO_SANDBOX"] === "1") {
      args.push("--no-sandbox");
    }
    const app = await electron.launch({
      executablePath: launchable,
      args,
      env: { ...process.env, JOB_FINDER_E2E: "1" },
    });

    try {
      const window = await app.firstWindow();
      await expect(window.getByRole("heading", { level: 1 })).toHaveText("Job Finder");

      const logFile = join(userDataDir, "logs", "main.log");
      const readLog = () => (existsSync(logFile) ? readFileSync(logFile, "utf8") : "");
      await expect.poll(readLog, { timeout: 60_000 }).toContain("engine ready");
      expect(readLog()).toMatch(/applied \d+ migration\(s\)/);

      const resourcesPath = await app.evaluate(() => process.resourcesPath);
      expect(existsSync(join(resourcesPath, "drizzle", "meta"))).toBe(true);

      const databaseFile = join(userDataDir, "job-finder.sqlite");
      const applied = await app.evaluate((_electron, file) => {
        const sqlite = process.getBuiltinModule("node:sqlite");
        if (!sqlite) {
          throw new Error("node:sqlite is not available in the main process");
        }
        const database = new sqlite.DatabaseSync(file, { readOnly: true });
        try {
          const row = database
            .prepare("SELECT COUNT(*) AS count FROM __drizzle_migrations")
            .get() as { count: number };
          return row.count;
        } finally {
          database.close();
        }
      }, databaseFile);
      expect(applied).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});
