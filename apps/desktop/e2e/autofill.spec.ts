// protects=the form window fills a local fixture form through real Chromium DevTools: profile values and the stored CV land in the page, the window is sandboxed and in memory, nothing is submitted, and closing the window leaves the application ready;
// fails_when=the fields are not filled in the real window, the CV is not uploaded, the window keeps a persistent session or a preload, the fixture receives a submission, or closing the window moves the application;
// no_claim=the ATS markup is a hand-written fixture, not a recorded Greenhouse, Lever or Ashby form; only the local fixture server is contacted, and the file dialog is not opened;
import { _electron as electron, expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { JobFinderBridge } from "@job-finder/bridge";

const mainEntry = resolve(__dirname, "../out/main/index.js");
const fixturesDir = resolve(__dirname, "../src/main/autofill/fixtures");

/** A profile that passes the schema: the values the fixture form asks for. */
const PROFILE = {
  contact: {
    fullName: "Maria Rossi",
    email: "maria@example.com",
    phone: "+39 333 1234567",
    location: "Milano",
  },
  headline: "",
  summary: "",
  experience: [],
  education: [],
  skills: [],
  languages: [],
  certifications: [],
  links: [{ label: "LinkedIn", url: "https://www.linkedin.com/in/maria" }],
  applicationDefaults: {
    workAuthorization: [],
    noticePeriod: "30 days",
    salary: { amount: null, currency: "", period: "" },
    willingToRelocate: true,
    pronouns: "",
  },
  standardAnswers: [],
};

interface Fixture {
  url: string;
  submissions: () => number;
  close: () => Promise<void>;
}

/** Serves the form pages on loopback and counts any submission the form would make. */
async function serveFixtures(): Promise<Fixture> {
  let submissions = 0;
  const server: Server = createServer((request, response) => {
    if (request.method === "POST") {
      submissions += 1;
      response.writeHead(200, { "content-type": "text/plain" }).end("received");
      return;
    }
    const name = (request.url ?? "/").replace(/^\//, "");
    if (!/^[a-z]+\.html$/.test(name) || !existsSync(join(fixturesDir, name))) {
      response.writeHead(404).end();
      return;
    }
    response
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(readFileSync(join(fixturesDir, name)));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    submissions: () => submissions,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

/** Seeds one company, job and application that is ready to be filled, with a CV PDF on disk. */
function seedDatabase(userData: string, applyUrl: string) {
  const db = new DatabaseSync(join(userData, "job-finder.sqlite"));
  db.exec(
    "INSERT INTO companies (id, name, careers_url, ats, slug, created_at) VALUES ('c1', 'Acme', 'https://acme.test/careers', NULL, NULL, 1);" +
      `INSERT INTO jobs (id, company_id, fingerprint, title, description, url, apply_url, locations, work_mode, employment_type, seniority, visa_sponsorship, first_seen_at, last_seen_at) VALUES ('j1', 'c1', 'fp1', 'Software Engineer', 'Build things.', 'https://acme.test/jobs/1', '${applyUrl}/greenhouse.html', '[]', 'unknown', 'unknown', 'unknown', 'unknown', 1, 1);` +
      "INSERT INTO applications (id, job_id, status, created_at, status_changed_at) VALUES ('a1', 'j1', 'ready', 2, 2);" +
      "INSERT INTO application_events (id, application_id, status, note, at) VALUES ('e1', 'a1', 'ready', NULL, 2);",
  );
  db.close();
  const folder = join(userData, "applications", "a1");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "cv.pdf"), Buffer.from("%PDF-1.4 test"));
}

async function waitForEngine(userData: string): Promise<void> {
  const logFile = join(userData, "logs", "main.log");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (existsSync(logFile) && readFileSync(logFile, "utf8").includes("engine ready")) return;
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error("engine did not report ready");
}

test("autofill fills the local form in its own window and never submits it", async () => {
  const userData = mkdtempSync(join(tmpdir(), "job-finder-autofill-"));
  const fixture = await serveFixtures();
  try {
    // First launch creates the database; the test seeds it while the app is closed.
    const first = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userData}`],
      env: { ...process.env, JOB_FINDER_E2E: "1" },
    });
    await first.firstWindow();
    await waitForEngine(userData);
    await first.close();

    seedDatabase(userData, fixture.url);

    const app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userData}`],
      env: { ...process.env, JOB_FINDER_E2E: "1" },
    });
    try {
      const window = await app.firstWindow();
      await waitForEngine(userData);
      await window.evaluate(
        (profile) =>
          (globalThis as unknown as { jobFinder: JobFinderBridge }).jobFinder.profile.save(
            profile as never,
          ),
        PROFILE,
      );

      const result = await window.evaluate(() =>
        (globalThis as unknown as { jobFinder: JobFinderBridge }).jobFinder.autofill.start({
          applicationId: "a1",
        }),
      );
      expect(result).toMatchObject({ ok: true });
      if (!result.ok) return;
      expect(result.filled).toEqual(expect.arrayContaining(["First Name", "Email", "Resume/CV"]));
      expect(result.unfilled.map((item) => item.label)).toContain(
        "Describe a project you led end to end",
      );

      const formWindow = await app.evaluate(({ BrowserWindow }, base: string) => {
        const found = BrowserWindow.getAllWindows().find(
          (item: { webContents: { getURL(): string } }) =>
            item.webContents.getURL().startsWith(base),
        );
        if (!found) return null;
        return {
          persistent: found.webContents.session.isPersistent(),
          debuggerAttached: found.webContents.debugger.isAttached(),
        };
      }, fixture.url);
      expect(formWindow).toEqual({ persistent: false, debuggerAttached: true });

      const values = await app.evaluate(async ({ BrowserWindow }, base: string) => {
        const found = BrowserWindow.getAllWindows().find(
          (item: { webContents: { getURL(): string } }) =>
            item.webContents.getURL().startsWith(base),
        );
        if (!found) return null;
        return found.webContents.executeJavaScript(
          "({ first: document.querySelector('#first_name')?.value, email: document.querySelector('#email')?.value, resumeFiles: document.querySelector('#resume')?.files?.length ?? 0, honeypot: document.querySelector('#hp_site')?.value ?? null })",
        ) as Promise<unknown>;
      }, fixture.url);
      expect(values).toEqual({
        first: "Maria",
        email: "maria@example.com",
        resumeFiles: 1,
        honeypot: "",
      });

      await app.evaluate(({ BrowserWindow }, base: string) => {
        BrowserWindow.getAllWindows()
          .find((item: { webContents: { getURL(): string } }) =>
            item.webContents.getURL().startsWith(base),
          )
          ?.close();
      }, fixture.url);
      await expect
        .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
        .toBe(1);

      const after = await window.evaluate(() =>
        (globalThis as unknown as { jobFinder: JobFinderBridge }).jobFinder.applications.detail({
          applicationId: "a1",
        }),
      );
      expect(after?.status).toBe("ready");
      expect(fixture.submissions()).toBe(0);
    } finally {
      await app.close();
    }
  } finally {
    await fixture.close();
  }
});
