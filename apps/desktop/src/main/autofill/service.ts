import type {
  ApplicationDetail,
  AutofillAiState,
  AutofillFailureCode,
  AutofillStartRequest,
  AutofillStartResult,
  AutofillUnfilled,
} from "@job-finder/bridge";
import { detectAts, type AtsId } from "@job-finder/core/ats";
import {
  MAX_AI_FIELDS,
  planAiAnswers,
  planAutofill,
  type AiFillPlan,
  type AutofillSources,
  type FillAction,
  type FormField,
  type UnfilledReason,
} from "@job-finder/core/ats/autofill";
import type { DocumentKind } from "@job-finder/core/documents/schema";
import type { Profile } from "@job-finder/core/profile";
import type { CdpSession, DebuggerLike, FrameContext } from "./cdp";
import { openCdpSession } from "./cdp";
import type { AiFill, AiFillStatus } from "./ai-fill";
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
  /**
   * A PDF of the application's stored document, written to a file for the upload, and its path; null
   * when no such document is stored. The PDF is made when the form opens, so no earlier export is needed.
   */
  documentFile(applicationId: string, kind: DocumentKind): Promise<string | null>;
  openWindow(): ApplyWindow;
  /** How long the form may take to load. */
  loadTimeoutMs?: number;
  /**
   * How long to wait for fields to appear after the page has loaded: many forms are drawn by
   * scripts a moment later. The wait ends as soon as one field is found.
   */
  fieldWaitMs?: number;
  /** How often the page is looked at again while waiting for fields. */
  fieldPollMs?: number;
  /**
   * The AI fallback. Omitted, a request for the fallback reports the AI as not configured; the
   * rules-based fill runs either way.
   */
  ai?: AiFill;
}

export interface AutofillService {
  start(request: AutofillStartRequest): Promise<AutofillStartResult>;
}

/** Statuses in which the application is being prepared: the form may be filled. */
const PREPARING_STATUSES = new Set(["preparing", "ready"]);
const DEFAULT_LOAD_TIMEOUT_MS = 30_000;
const DEFAULT_FIELD_WAIT_MS = 8_000;
const DEFAULT_FIELD_POLL_MS = 400;
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

/** Looks for fields until one is found or the wait is over, since scripts may draw the form late. */
async function discoverFieldsWhenDrawn(
  session: CdpSession,
  contexts: FrameContext[],
  waitMs: number,
  pollMs: number,
) {
  const deadline = Date.now() + waitMs;
  let found = await discoverFields(session, contexts);
  while (found.fields.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    found = await discoverFields(session, contexts);
  }
  return found;
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

  // A planned fill that no frame took and none refused (the control vanished, or already held a
  // value) must not disappear: it is reported and highlighted like any refused field.
  for (const action of textActions) {
    if (!taken.has(action.id)) refused.add(action.id);
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
  const fieldWaitMs = options.fieldWaitMs ?? DEFAULT_FIELD_WAIT_MS;
  const fieldPollMs = options.fieldPollMs ?? DEFAULT_FIELD_POLL_MS;
  let current: ApplyWindow | null = null;

  async function start(request: AutofillStartRequest): Promise<AutofillStartResult> {
    try {
      return await run(request);
    } catch (error) {
      if (error instanceof AutofillFailure) return { ok: false, code: error.code };
      return { ok: false, code: "autofill-failed" };
    }
  }

  async function run(request: AutofillStartRequest): Promise<AutofillStartResult> {
    const applicationId = request.applicationId;
    const detail = await options.applications.detail(applicationId);
    if (detail === null) throw new AutofillFailure("not-found");
    if (!PREPARING_STATUSES.has(detail.status)) throw new AutofillFailure("invalid-status");
    const url = webUrl(detail.applyUrl);
    if (url === undefined) throw new AutofillFailure("invalid-url");
    const saved = await options.profile.get();
    if (saved === null) throw new AutofillFailure("no-profile");

    // The profile and the form fields go to a cloud provider only with consent, checked before a window opens.
    const wantsAi = request.aiFallback === true;
    const aiStatus: AiFillStatus =
      wantsAi && options.ai !== undefined ? await options.ai.status() : { state: "not-configured" };
    if (
      wantsAi &&
      aiStatus.state === "ready" &&
      aiStatus.cloud &&
      !(request.consent === true && request.consentTarget === aiStatus.consentTarget)
    ) {
      throw new AutofillFailure("consent-required");
    }

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
      const { fields, contextOf } = await discoverFieldsWhenDrawn(
        session,
        contexts,
        fieldWaitMs,
        fieldPollMs,
      );
      const provider: AtsId | "generic" = detectAts({ url: window.currentUrl() })?.ats ?? "generic";
      const files: Record<DocumentKind, string | null> = {
        cv: await options.documentFile(applicationId, "cv").catch(() => null),
        "cover-letter": await options.documentFile(applicationId, "cover-letter").catch(() => null),
      };
      const sources: AutofillSources = {
        profile: saved.profile,
        documents: { cv: files.cv !== null, "cover-letter": files["cover-letter"] !== null },
      };
      const plan = planAutofill(fields, sources, provider);
      // A document the plan uploads is one the file was made for.
      const docPath = (kind: DocumentKind) => files[kind] ?? "";
      const { taken, refused } = await applyActions(
        session,
        contexts,
        contextOf,
        plan.actions,
        docPath,
      );

      // The AI maps only the fields the rules could not map. Its fills go through the same actions.
      let ai: AutofillAiState = { state: "off" };
      let aiPlan: AiFillPlan | null = null;
      if (wantsAi) {
        if (options.ai === undefined || aiStatus.state === "not-configured") {
          ai = { state: "unavailable", code: "not-configured" };
        } else {
          const byId = new Map(fields.map((field) => [field.id, field]));
          const candidates = plan.unfilled
            .filter((item) => item.reason === "unmapped")
            .slice(0, MAX_AI_FIELDS)
            .flatMap((item) => {
              const field = byId.get(item.id);
              return field === undefined ? [] : [field];
            });
          const outcome =
            candidates.length === 0
              ? { ok: true as const, answers: [] }
              : await options.ai.map({
                  applicationId,
                  profile: saved.profile,
                  fields: candidates,
                  consent: request.consent === true,
                  consentTarget: request.consentTarget,
                });
          if (!outcome.ok) {
            ai = { state: "unavailable", code: outcome.code };
          } else {
            aiPlan = planAiAnswers(candidates, outcome.answers, sources);
            const applied = await applyActions(
              session,
              contexts,
              contextOf,
              aiPlan.actions,
              docPath,
            );
            applied.taken.forEach((id) => taken.add(id));
            applied.refused.forEach((id) => refused.add(id));
            ai = { state: "used" };
          }
        }
      }

      const labelOf = new Map(fields.map((field) => [field.id, field.label || field.name]));
      // Every field left over, once, in the page's order; the AI's reason replaces the rule's.
      const leftOver = new Map<string, { label: string; reason: UnfilledReason }>();
      // Map keeps the first insertion order, so a later reason replaces the earlier one in place.
      const leave = (id: string, label: string, reason: UnfilledReason) => {
        if (taken.has(id)) return;
        leftOver.set(id, { label, reason });
      };
      for (const item of plan.unfilled) leave(item.id, item.label, item.reason);
      for (const item of aiPlan?.unfilled ?? []) leave(item.id, item.label, item.reason);
      for (const id of refused) leave(id, labelOf.get(id) ?? "", "rejected");

      const drafted = (aiPlan?.drafted ?? []).filter((id) => taken.has(id));
      const highlightIds = [...leftOver.keys()];
      for (const context of contexts) {
        await session
          .evaluate(context.id, highlightExpression(highlightIds, drafted))
          .catch(() => undefined);
      }

      const labelOfFill = (action: FillAction) => labelOf.get(action.id) ?? "";
      const filled = [...plan.actions, ...(aiPlan?.actions ?? [])]
        .filter((action) => taken.has(action.id))
        .map(labelOfFill);
      const unfilled: AutofillUnfilled[] = [...leftOver.values()].map(({ label, reason }) => ({
        label,
        reason,
      }));
      return {
        ok: true,
        provider,
        filled,
        drafted: drafted.map((id) => labelOf.get(id) ?? ""),
        unfilled,
        ai,
      };
    } catch (error) {
      window.close();
      if (error instanceof AutofillFailure) throw error;
      throw new AutofillFailure("autofill-failed");
    }
  }

  return { start };
}
