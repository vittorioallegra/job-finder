// protects=the packaged-style build opens one window with the home screen, starts the engine utility process (ready after a ping), and a second launch focuses it instead of opening another;
// fails_when=the window does not load the renderer, or a second instance keeps running or creates a second window;
// no_claim=installers, code signing and the packaged app on Windows and Linux are covered by a later step.
import { _electron as electron, expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const mainEntry = resolve(__dirname, "../out/main/index.js");
const electronBinary = createRequire(__filename)("electron") as string;

test("window opens and a second launch does not open a second window", async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), "job-finder-e2e-"));
  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, JOB_FINDER_E2E: "1" },
  });

  try {
    const window = await app.firstWindow();
    // The brand link names the app in every UI language.
    await expect(window.getByRole("link", { name: /Job Finder/ })).toBeVisible();
    const logFile = join(userDataDir, "logs", "main.log");
    await expect
      .poll(() => (existsSync(logFile) ? readFileSync(logFile, "utf8") : ""), { timeout: 30_000 })
      .toContain("engine ready");

    const second = spawn(electronBinary, [mainEntry, `--user-data-dir=${userDataDir}`], {
      stdio: "ignore",
    });
    const exitCode = await new Promise<number | null>((done) => {
      const timer = setTimeout(() => done(null), 30_000);
      second.on("exit", (code) => {
        clearTimeout(timer);
        done(code);
      });
    });
    expect(exitCode).toBe(0);

    const windowCount = await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    );
    expect(windowCount).toBe(1);
  } finally {
    await app.close();
  }
});
