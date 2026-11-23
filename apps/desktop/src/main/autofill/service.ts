import type {
  ApplicationDetail,
  AutofillFailureCode,
  AutofillStartRequest,
  AutofillStartResult,
  AutofillUnfilled,
} from "@job-finder/bridge";
import { detectAts, type AtsId } from "@job-finder/core/ats";
import { planAutofill, type FillAction, type FormField } from "@job-finder/core/ats/autofill";
import type { DocumentKind } from "@job-finder/core/documents/schema";
import type { Profile } from "@job-finder/core/profile";
import type { CdpSession, DebuggerLike, FrameContext } from "./cdp";
import { openCdpSession } from "./cdp";
import {
  discoverExpression,
  fillExpression,
  findExpression,
  highlightExpression,
} from "./page-script";

/** The form window as autofill drives it. Only main creates one. */
export interface ApplyWindow {
  readonly debuggerApi: DebuggerLike;
  /** Loads the form and resolves once the page has finished loading. */
  load(url: string): Promise<void>;
  currentUrl(): string;
  onClosed(listener: () => void): void;
  close(): void;
}

export interface AutofillServiceOptions {
  applications: { detail(applicationId: string): Promise<ApplicationDetail | null> };
  profile: { get(): Promise<{ profile: Profile } | null> };
  /** Whether a PDF of the document exists for the application. */
  documentExists(applicationId: string, kind: DocumentKind): boolean;
  /** Where the PDF of the document is stored, for the upload. */
  documentPath(applicationId: string, kind: DocumentKind): string;
  openWindow(): ApplyWindow;
  /** How long the form may take to load. */
  loadTimeoutMs?: number;
}

export interface AutofillService {
  start(request: AutofillStartRequest): Promise<AutofillStartResult>;
}

/** Statuses in which the application is being prepared: the form may be filled. */
const PREPARING_STATUSES = new Set(["preparing", "ready"]);
const DEFAULT_LOAD_TIMEOUT_MS = 30_000;
/** Field ids the page script stamps (`c<frame index>-<n>`). Any other id is ignored. */
const FIELD_ID = /^c\d+-\d+$/;

class AutofillFailure extends Error {
  constructor(readonly code: AutofillFailureCode) {
    super(code);
  }
}

function webUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Lists the fields of every frame, and remembers which frame holds each one. */
async function discoverFields(session: CdpSession, contexts: FrameContext[]) {
  const fields: FormField[] = [];
  const contextOf = new Map<string, number>();
  for (const [index, context] of contexts.entries()) {
    // A frame that went away while the page loads is skipped, not fatal.
    const found = await session
      .evaluate(context.id, discoverExpression(`c${index}`))
      .then((value) => (Array.isArray(value) ? (value as FormField[]) : []))
      .catch(() => [] as FormField[]);
    for (const field of found) {
      if (!FIELD_ID.test(field.id)) continue;
      fields.push(field);
      contextOf.set(field.id, context.id);
    }
  }
  return { fields, contextOf };
}

/**
 * Sets the text and choice values in every frame (each frame ignores the ids it does not hold), and
 * uploads the files. Returns the ids the page took and the ids it refused.
 */
async function applyActions(
  session: CdpSession,
  contexts: FrameContext[],
  contextOf: Map<string, number>,
  actions: FillAction[],
  documentPath: (kind: DocumentKind) => string,
) {
  const taken = new Set<string>();
  const refused = new Set<string>();
  const textActions = actions.flatMap((action) =>
    action.kind === "file" ? [] : [{ id: action.id, kind: action.kind, value: action.value }],
  );
  for (const context of contexts) {
    const results = await session
      .evaluate(context.id, fillExpression(textActions))
      .then((value) =>
        Array.isArray(value) ? (value as Array<{ id: string; ok: boolean; reason?: string }>) : [],
      )
      .catch(() => []);
    for (const result of results) {
      if (result.ok) taken.add(result.id);
      else if (result.reason !== "has-value") refused.add(result.id);
    }
  }

  for (const action of actions) {
    if (action.kind !== "file") continue;
    const contextId = contextOf.get(action.id);
    try {
      if (contextId === undefined) throw new Error("no frame");
      const handle = await session.handleOf(contextId, findExpression(action.id));
      if (handle === null) throw new Error("no control");
      await session.setFiles(handle, [documentPath(action.document)]);
      taken.add(action.id);
    } catch {
      refused.add(action.id);
    }
  }
  return { taken, refused };
}

/**
 * Opens an application's form in its own window and fills it from the profile and the stored PDFs.
 * The window stays open for the user. This code never clicks, presses a key or submits; the user
 * reviews, edits and submits. Only one form window is open at a time: starting again closes the
 * previous one.
 */
export function createAutofillService(options: AutofillServiceOptions): AutofillService {
  const loadTimeoutMs = options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
  let current: ApplyWindow | null = null;

  async function start(request: AutofillStartRequest): Promise<AutofillStartResult> {
    try {
      return await run(request.applicationId);
    } catch (error) {
      if (error instanceof AutofillFailure) return { ok: false, code: error.code };
      return { ok: false, code: "autofill-failed" };
    }
  }

  async function run(applicationId: string): Promise<AutofillStartResult> {
    const detail = await options.applications.detail(applicationId);
    if (detail === null) throw new AutofillFailure("not-found");
    if (!PREPARING_STATUSES.has(detail.status)) throw new AutofillFailure("invalid-status");
    const url = webUrl(detail.applyUrl);
    if (url === undefined) throw new AutofillFailure("invalid-url");
    const saved = await options.profile.get();
    if (saved === null) throw new AutofillFailure("no-profile");

    current?.close();
    const window = options.openWindow();
    current = window;
    window.onClosed(() => {
      if (current === window) current = null;
    });

    try {
      await withTimeout(window.load(url), loadTimeoutMs).catch(() => {
        throw new AutofillFailure("load-failed");
      });
    } catch (error) {
      window.close();
      throw error;
    }

    const session = openCdpSession(window.debuggerApi);
    window.onClosed(() => session.close());
    try {
      const contexts = await session.open().catch(() => {
        throw new AutofillFailure("debugger-failed");
      });
      const { fields, contextOf } = await discoverFields(session, contexts);
      const provider: AtsId | "generic" = detectAts({ url: window.currentUrl() })?.ats ?? "generic";
      const plan = planAutofill(
        fields,
        {
          profile: saved.profile,
          documents: {
            cv: options.documentExists(applicationId, "cv"),
            "cover-letter": options.documentExists(applicationId, "cover-letter"),
          },
        },
        provider,
      );
      const { taken, refused } = await applyActions(
        session,
        contexts,
        contextOf,
        plan.actions,
        (kind) => options.documentPath(applicationId, kind),
      );

      const labelOf = new Map(fields.map((field) => [field.id, field.label || field.name]));
      const unfilled: AutofillUnfilled[] = plan.unfilled.map((item) => ({
        label: item.label,
        reason: item.reason,
      }));
      for (const id of refused) {
        unfilled.push({ label: labelOf.get(id) ?? "", reason: "rejected" });
      }
      const highlightIds = [...plan.unfilled.map((item) => item.id), ...refused];
      for (const context of contexts) {
        await session
          .evaluate(context.id, highlightExpression(highlightIds))
          .catch(() => undefined);
      }

      const filled = plan.actions
        .filter((action) => taken.has(action.id))
        .map((action) => labelOf.get(action.id) ?? "");
      return { ok: true, provider, filled, unfilled };
    } catch (error) {
      window.close();
      if (error instanceof AutofillFailure) throw error;
      throw new AutofillFailure("autofill-failed");
    }
  }

  return { start };
}
