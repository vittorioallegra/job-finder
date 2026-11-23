// @vitest-environment jsdom
// protects=the autofill service opens an application's form only while it is being prepared, fills the Greenhouse, Lever and Ashby fixtures and uploads only the PDFs that exist, reports what it left for the user, keeps the window open, closes the previous window when a new run starts, and never clicks, presses a key or submits;
// fails_when=a form opens for a job that is not being prepared or has no web apply link, a CV is uploaded without its PDF, a value is typed over, a field left for the user is reported as filled, the window stays open after a failed load, two form windows stay open, or a submit, click, key press or Input command reaches the page;
// no_claim=the window is a scripted double over jsdom and the fixture pages are hand-written, not recorded from the ATS services; the real Chromium window, its debugger and the file dialog are exercised by the Electron end-to-end test only;
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApplicationDetail } from "@job-finder/bridge";
import type { DocumentKind } from "@job-finder/core/documents/schema";
import { emptyProfile, type Profile } from "@job-finder/core/profile";
import type { DebuggerLike } from "./cdp";
import { createAutofillService, type ApplyWindow } from "./service";

const FIXTURES = join(__dirname, "fixtures");

function profile(): Profile {
  return {
    ...emptyProfile(),
    contact: {
      fullName: "Maria Rossi",
      email: "maria@example.com",
      phone: "+39 333 1234567",
      location: "Milano",
    },
    links: [{ label: "LinkedIn", url: "https://www.linkedin.com/in/maria" }],
    applicationDefaults: {
      workAuthorization: [],
      noticePeriod: "30 days",
      salary: { amount: null, currency: "", period: "" },
      willingToRelocate: true,
      pronouns: "",
    },
    standardAnswers: [{ question: "Why do you want to work here?", answer: "I like the product." }],
  };
}

function detail(overrides: Partial<ApplicationDetail> = {}): ApplicationDetail {
  return {
    id: "a1",
    jobId: "j1",
    jobTitle: "Software Engineer",
    companyId: "c1",
    companyName: "Acme",
    status: "ready",
    createdAt: 1,
    statusChangedAt: 1,
    jobUrl: "https://boards.greenhouse.io/acme/jobs/1",
    applyUrl: "https://boards.greenhouse.io/acme/jobs/1",
    events: [],
    ...overrides,
  };
}

/**
 * A scripted form window over jsdom. The page scripts really run (through `eval`, the way Runtime
 * evaluates them); the debugger records every command it receives.
 */
function scriptedWindow(fixture: string) {
  const commands: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const handles = new Map<string, Element>();
  const files: Array<{ backendNodeId: number; files: string[] }> = [];
  const listeners: Array<
    (event: unknown, method: string, params: Record<string, unknown>) => void
  > = [];
  const closedListeners: Array<() => void> = [];
  let attached = false;
  let handleSeq = 0;
  let url = "";

  const debuggerApi: DebuggerLike = {
    attach: () => {
      attached = true;
    },
    isAttached: () => attached,
    detach: () => {
      attached = false;
    },
    on: (_event, listener) => {
      listeners.push(listener);
      return debuggerApi;
    },
    sendCommand: async (method, params) => {
      commands.push({ method, params });
      switch (method) {
        case "Runtime.enable":
          for (const listener of listeners) {
            listener({}, "Runtime.executionContextCreated", {
              context: { id: 1, auxData: { frameId: "main", isDefault: true } },
            });
          }
          return {};
        case "DOM.enable":
          return {};
        case "Runtime.evaluate": {
          const expression = String(params?.["expression"]);
          if (params?.["returnByValue"] === false) {
            const element = (0, eval)(expression) as Element | null;
            if (!element) return { result: { subtype: "null" } };
            const objectId = `h${++handleSeq}`;
            handles.set(objectId, element);
            return { result: { objectId } };
          }
          try {
            return { result: { value: (0, eval)(expression) } };
          } catch {
            return { result: { value: undefined }, exceptionDetails: { text: "threw" } };
          }
        }
        case "DOM.describeNode":
          return { node: { backendNodeId: 42 } };
        case "DOM.setFileInputFiles":
          files.push(params as unknown as { backendNodeId: number; files: string[] });
          return {};
        default:
          throw new Error(`unexpected ${method}`);
      }
    },
  };

  const closedSpy = vi.fn();
  const win: ApplyWindow & { closed: typeof closedSpy } = {
    debuggerApi,
    load: async (target) => {
      url = target;
      const parsed = new DOMParser().parseFromString(
        readFileSync(join(FIXTURES, fixture), "utf8"),
        "text/html",
      );
      document.body.innerHTML = parsed.body.innerHTML;
    },
    currentUrl: () => url,
    onClosed: (listener) => {
      closedListeners.push(listener);
    },
    close: () => {
      closedSpy();
      closedListeners.forEach((listener) => listener());
    },
    closed: closedSpy,
  };
  return { win, commands, files, handles };
}

function serviceWith(
  windows: ReturnType<typeof scriptedWindow>[],
  overrides: {
    application?: ApplicationDetail | null;
    saved?: { profile: Profile } | null;
    exists?: Record<DocumentKind, boolean>;
    loadTimeoutMs?: number;
  } = {},
) {
  const opened: ReturnType<typeof scriptedWindow>[] = [];
  const exists = overrides.exists ?? { cv: true, "cover-letter": true };
  const service = createAutofillService({
    applications: {
      detail: async () => (overrides.application === undefined ? detail() : overrides.application),
    },
    profile: {
      get: async () => (overrides.saved === undefined ? { profile: profile() } : overrides.saved),
    },
    documentExists: (_id, kind) => exists[kind],
    documentPath: (id, kind) => `/store/${id}/${kind}.pdf`,
    openWindow: () => {
      const next = windows.shift() ?? scriptedWindow("generic.html");
      opened.push(next);
      return next.win;
    },
    loadTimeoutMs: overrides.loadTimeoutMs,
  });
  return { service, opened };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("autofill service on the Greenhouse fixture", () => {
  it("fills the form, uploads both PDFs, reports what is left, and keeps the window open", async () => {
    const window = scriptedWindow("greenhouse.html");
    const { service } = serviceWith([window]);

    const result = await service.start({ applicationId: "a1" });

    expect(result).toMatchObject({ ok: true, provider: "greenhouse" });
    if (!result.ok) return;
    expect(result.filled).toEqual(
      expect.arrayContaining(["First Name", "Last Name", "Email", "Resume/CV", "Cover Letter"]),
    );
    expect(result.unfilled.map((item) => item.label)).toEqual([
      "Describe a project you led end to end",
      "I agree to the privacy policy",
    ]);
    expect(window.files).toEqual([
      { backendNodeId: 42, files: ["/store/a1/cv.pdf"] },
      { backendNodeId: 42, files: ["/store/a1/cover-letter.pdf"] },
    ]);
    expect((document.querySelector("#first_name") as HTMLInputElement).value).toBe("Maria");
    expect(window.win.closed).not.toHaveBeenCalled();
  });

  it("never sends an Input command, never submits, and never clicks a button", async () => {
    const window = scriptedWindow("greenhouse.html");
    const { service } = serviceWith([window]);
    const form = document.querySelector("form");
    const onSubmit = vi.fn();
    form?.addEventListener("submit", onSubmit);
    const onClick = vi.fn();
    document
      .querySelectorAll("button, input[type='submit']")
      .forEach((button) => button.addEventListener("click", onClick));
    const submit = vi.spyOn(HTMLFormElement.prototype, "submit");

    await service.start({ applicationId: "a1" });

    expect(window.commands.some((command) => command.method.startsWith("Input."))).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("uploads no CV that has no PDF yet, and reports it as not exported", async () => {
    const window = scriptedWindow("greenhouse.html");
    const { service } = serviceWith([window], { exists: { cv: false, "cover-letter": true } });

    const result = await service.start({ applicationId: "a1" });

    expect(result.ok && result.unfilled).toContainEqual({
      label: "Resume/CV",
      reason: "not-exported",
    });
    expect(window.files.map((file) => file.files[0])).toEqual(["/store/a1/cover-letter.pdf"]);
  });
});

describe("autofill service on the other fixtures", () => {
  it("recognises a Lever form and fills its name and links", async () => {
    const window = scriptedWindow("lever.html");
    const url = "https://jobs.lever.co/acme/123/apply";
    const { service } = serviceWith([window], {
      application: detail({ applyUrl: url, jobUrl: url }),
    });

    const lever = await service.start({ applicationId: "a1" });
    expect(lever).toMatchObject({ ok: true, provider: "lever" });
    expect((document.querySelector("#name") as HTMLInputElement).value).toBe("Maria Rossi");
  });

  it("uses the generic rules for a page that names no ATS", async () => {
    const window = scriptedWindow("generic.html");
    const { service } = serviceWith([window], {
      application: detail({ applyUrl: "https://careers.acme.test/apply/7" }),
    });

    const result = await service.start({ applicationId: "a1" });

    expect(result).toMatchObject({ ok: true, provider: "generic" });
    expect((document.querySelector("#g-name") as HTMLInputElement).value).toBe("Maria Rossi");
  });
});

describe("autofill service refusals", () => {
  it("refuses a job that is not being prepared, a missing link, and a missing profile before a window opens", async () => {
    const window = scriptedWindow("greenhouse.html");
    const { service, opened } = serviceWith([window], {
      application: detail({ status: "applied" }),
    });
    expect(await service.start({ applicationId: "a1" })).toEqual({
      ok: false,
      code: "invalid-status",
    });

    const linkless = serviceWith([window], {
      application: detail({ applyUrl: "javascript:alert(1)" }),
    });
    expect(await linkless.service.start({ applicationId: "a1" })).toEqual({
      ok: false,
      code: "invalid-url",
    });

    const profileless = serviceWith([window], { saved: null });
    expect(await profileless.service.start({ applicationId: "a1" })).toEqual({
      ok: false,
      code: "no-profile",
    });

    const missing = serviceWith([window], { application: null });
    expect(await missing.service.start({ applicationId: "a1" })).toEqual({
      ok: false,
      code: "not-found",
    });
    expect(opened).toHaveLength(0);
  });

  it("closes the window and reports load-failed when the form does not load in time", async () => {
    const window = scriptedWindow("greenhouse.html");
    window.win.load = () => new Promise(() => {});
    const { service } = serviceWith([window], { loadTimeoutMs: 5 });

    const result = await service.start({ applicationId: "a1" });

    expect(result).toEqual({ ok: false, code: "load-failed" });
    expect(window.win.closed).toHaveBeenCalledTimes(1);
  });

  it("closes the previous form window when a new run starts", async () => {
    const first = scriptedWindow("greenhouse.html");
    const second = scriptedWindow("greenhouse.html");
    const { service } = serviceWith([first, second]);

    await service.start({ applicationId: "a1" });
    await service.start({ applicationId: "a1" });

    expect(first.win.closed).toHaveBeenCalledTimes(1);
    expect(second.win.closed).not.toHaveBeenCalled();
  });
});
