// protects=the full journey works in the Electron app against the local fixture server and replayed AI: onboarding, a keyless search, a company scan, opening the job, preparing a CV and cover letter (with PDFs), autofill of a local form without submitting it, marking the application applied, and the duplicate guard refusing a second attempt;
// fails_when=a step returns an unexpected result, any request reaches a path the journey did not plan (including an AI request with no replay), the form receives a submission, or a second preparation of the same job is not refused;
// no_claim=the journey drives the renderer bridge, not the UI clicks; AI answers are hand-made replays, not model output; the update check and OS notifications stay off; real ATS boards, search providers and the Ollama or provider setup are not contacted or tested here.
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serveJourneyFixtures, type JourneyFixtures } from "./journey-fixtures";

const mainEntry = resolve(__dirname, "../out/main/index.js");

/** The profile the CV and cover letter replays and the autofill fixture rely on. */
const PROFILE = {
  contact: {
    fullName: "Maria Rossi",
    email: "maria@example.com",
    phone: "+39 333 1234567",
    location: "Milano",
  },
  headline: "Backend engineer",
  summary: "Backend engineer who builds payment services in TypeScript.",
  experience: [
    {
      company: "Northwind",
      title: "Backend Engineer",
      location: "Milano",
      startDate: "2021",
      endDate: "Present",
      bullets: ["Reduced checkout latency by 35 percent"],
    },
  ],
  education: [
    {
      institution: "Politecnico di Milano",
      degree: "BSc in Computer Engineering",
      category: "degree",
      grade: "",
      startDate: "2014",
      endDate: "2017",
    },
  ],
  skills: [
    { name: "TypeScript", level: "", aliases: [] },
    { name: "PostgreSQL", level: "", aliases: [] },
  ],
  languages: [
    { name: "Italian", level: "Native" },
    { name: "English", level: "Fluent" },
  ],
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

/** Calls one bridge method in the renderer. The bridge is reached only through `window.jobFinder`. */
async function call<T>(page: Page, group: string, name: string, ...args: unknown[]): Promise<T> {
  const result = await page.evaluate(
    async ({ group, name, args }) => {
      const bridge = (
        globalThis as unknown as {
          jobFinder: Record<string, Record<string, (...values: unknown[]) => Promise<unknown>>>;
        }
      ).jobFinder;
      return bridge[group]![name]!(...args);
    },
    { group, name, args },
  );
  return result as T;
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

async function waitForScan(page: Page): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const latest = await call<{ run: { finishedAt: number | null } } | null>(
      page,
      "ingest",
      "latest",
    );
    if (latest?.run.finishedAt) return;
    await new Promise((done) => setTimeout(done, 300));
  }
  throw new Error("the company scan did not finish");
}

test("the journey runs from onboarding to a blocked second application", async () => {
  const userData = mkdtempSync(join(tmpdir(), "job-finder-journey-"));
  const fixtures: JourneyFixtures = await serveJourneyFixtures();
  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userData}`],
    env: { ...process.env, JOB_FINDER_E2E: "1", JOB_FINDER_FIXTURE_BASE_URL: fixtures.url },
  });

  try {
    const window = await app.firstWindow();
    await waitForEngine(userData);

    // Onboarding: no profile yet, then the profile is saved.
    expect(await call(window, "profile", "get")).toBeNull();
    await call(window, "profile", "save", PROFILE);

    // Settings: English UI, and the AI is the replayed OpenAI-compatible endpoint on loopback.
    await call(window, "settings", "update", { ui: { language: "en" } });
    await call(window, "settings", "update", {
      ai: {
        provider: "openai-compatible",
        model: "fixture-replay-model",
        baseUrl: `${fixtures.url}/v1`,
        contextSize: 8192,
      },
    });
    expect(await call(window, "ai", "testConnection")).toMatchObject({ ok: true });

    // Search: keyless DuckDuckGo results name an Acme board; the company is added and scanned.
    const search = await call<{ ok: boolean; candidates?: { careersUrl: string }[] }>(
      window,
      "discovery",
      "search",
      { keywords: ["software engineer"], locations: [] },
    );
    expect(search.ok).toBe(true);
    const board = search.candidates?.find((candidate) => candidate.careersUrl.includes("acme"));
    expect(board).toBeDefined();
    const added = await call<{ ok: boolean; company?: { id: string } }>(
      window,
      "companies",
      "add",
      { name: "Acme", careersUrl: board?.careersUrl },
    );
    expect(added.ok).toBe(true);
    expect(await call(window, "ingest", "start")).toMatchObject({ ok: true });
    await waitForScan(window);

    const listed = await call<{ id: string; title: string }[]>(window, "jobs", "list", {
      filter: {},
      sort: "newest",
    });
    const job = listed.find((item) => item.title === "Software Engineer");
    expect(job).toBeDefined();
    if (!job) return;

    // Open the job and prepare it: a preparing application, a stored CV and cover letter (autofill prints them to PDFs when the form opens).
    expect(await call(window, "jobs", "detail", { jobId: job.id })).not.toBeNull();
    await call(window, "jobs", "flag", { jobId: job.id, viewed: true });

    const started = await call<{ ok: boolean; application?: { id: string; status: string } }>(
      window,
      "applications",
      "start",
      { jobId: job.id, confirmations: 0 },
    );
    expect(started).toMatchObject({ ok: true, application: { status: "preparing" } });
    const applicationId = started.application?.id ?? "";

    for (const kind of ["cv", "cover-letter"]) {
      expect(await call(window, "documents", "generate", { applicationId, kind })).toMatchObject({
        ok: true,
      });
    }
    expect(
      await call(window, "applications", "update", { applicationId, status: "ready" }),
    ).toMatchObject({
      ok: true,
    });

    // Autofill the local form in its own window. The app fills and never submits.
    const filled = await call<{ ok: boolean; filled?: string[] }>(window, "autofill", "start", {
      applicationId,
    });
    expect(filled).toMatchObject({ ok: true });
    expect(filled.filled).toEqual(expect.arrayContaining(["First Name", "Email", "Resume/CV"]));
    await app.evaluate(({ BrowserWindow }, base: string) => {
      BrowserWindow.getAllWindows()
        .find((item: { webContents: { getURL(): string } }) =>
          item.webContents.getURL().startsWith(base),
        )
        ?.close();
    }, fixtures.url);
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(1);

    // Mark applied by hand, after the user submitted the form themselves.
    const applied = await call<{ ok: boolean; application?: { status: string } }>(
      window,
      "applications",
      "update",
      { applicationId, status: "applied" },
    );
    expect(applied).toMatchObject({ ok: true, application: { status: "applied" } });

    // The duplicate guard: the same job needs two confirmations, so a second attempt is refused.
    const check = await call<{ sameJob: unknown[]; requiredConfirmations: number }>(
      window,
      "applications",
      "check",
      { jobId: job.id },
    );
    expect(check.sameJob).toHaveLength(1);
    expect(check.requiredConfirmations).toBe(2);
    for (const confirmations of [0, 1]) {
      expect(
        await call(window, "applications", "start", { jobId: job.id, confirmations }),
      ).toMatchObject({ ok: false, code: "duplicate-confirmation-required" });
    }
    expect(await call<unknown[]>(window, "applications", "list")).toHaveLength(1);

    // Nothing was submitted and nothing reached a host the journey did not plan for.
    expect(fixtures.submissions()).toBe(0);
    expect(fixtures.unexpected()).toEqual([]);
  } finally {
    await app.close();
    await fixtures.close();
  }
});
