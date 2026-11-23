/** The part of Electron's `webContents.debugger` the form window uses. */
export interface DebuggerLike {
  attach(protocolVersion?: string): void;
  isAttached(): boolean;
  detach(): void;
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(
    event: "message",
    listener: (event: unknown, method: string, params: Record<string, unknown>) => void,
  ): unknown;
}

/**
 * The only DevTools commands autofill may send. There is deliberately no `Input` domain: nothing
 * presses keys or clicks, so the app cannot submit a form through the page.
 */
export const ALLOWED_CDP_METHODS = [
  "Runtime.enable",
  "Runtime.evaluate",
  "DOM.enable",
  "DOM.describeNode",
  "DOM.setFileInputFiles",
] as const;
export type AllowedCdpMethod = (typeof ALLOWED_CDP_METHODS)[number];

/** A JavaScript context of one frame of the page (the main frame or a same-process iframe). */
export interface FrameContext {
  id: number;
  frameId: string;
}

export interface CdpSession {
  /** Attaches the debugger and returns the default context of every frame that is in this process. */
  open(): Promise<FrameContext[]>;
  /** Evaluates a script in one context and returns its JSON value. Throws when the script throws. */
  evaluate(contextId: number, expression: string): Promise<unknown>;
  /** Evaluates an expression that yields one element and returns a handle to it, or null. */
  handleOf(contextId: number, expression: string): Promise<string | null>;
  /** Puts the files into a file control, given the handle from `handleOf`. */
  setFiles(handle: string, files: string[]): Promise<void>;
  /** Detaches the debugger. Idempotent. */
  close(): void;
}

interface ContextEntry {
  frameId: string;
}

/** Opens a CDP session over the window's debugger. Only `ALLOWED_CDP_METHODS` can be sent. */
export function openCdpSession(debuggerApi: DebuggerLike): CdpSession {
  const contexts = new Map<number, ContextEntry>();

  debuggerApi.on("message", (_event, method, params) => {
    if (method === "Runtime.executionContextCreated") {
      const context = params["context"] as
        { id: number; auxData?: { frameId?: string; isDefault?: boolean } } | undefined;
      if (context && context.auxData?.isDefault === true && context.auxData.frameId) {
        contexts.set(context.id, { frameId: context.auxData.frameId });
      }
    } else if (method === "Runtime.executionContextDestroyed") {
      contexts.delete(params["executionContextId"] as number);
    } else if (method === "Runtime.executionContextsCleared") {
      contexts.clear();
    }
  });

  function send(method: AllowedCdpMethod, params: Record<string, unknown>): Promise<unknown> {
    if (!(ALLOWED_CDP_METHODS as readonly string[]).includes(method)) {
      return Promise.reject(new Error(`CDP method not allowed: ${method}`));
    }
    return debuggerApi.sendCommand(method, params);
  }

  return {
    async open() {
      if (!debuggerApi.isAttached()) {
        debuggerApi.attach("1.3");
      }
      await send("Runtime.enable", {});
      await send("DOM.enable", {});
      return [...contexts.entries()].map(([id, entry]) => ({ id, frameId: entry.frameId }));
    },

    async evaluate(contextId, expression) {
      const response = (await send("Runtime.evaluate", {
        contextId,
        expression,
        returnByValue: true,
        awaitPromise: false,
      })) as { result?: { value?: unknown }; exceptionDetails?: unknown };
      if (response.exceptionDetails !== undefined) {
        throw new Error("page script failed");
      }
      return response.result?.value;
    },

    async handleOf(contextId, expression) {
      const response = (await send("Runtime.evaluate", {
        contextId,
        expression,
        returnByValue: false,
        awaitPromise: false,
      })) as { result?: { objectId?: string }; exceptionDetails?: unknown };
      if (response.exceptionDetails !== undefined) {
        throw new Error("page script failed");
      }
      return response.result?.objectId ?? null;
    },

    async setFiles(handle, files) {
      const described = (await send("DOM.describeNode", { objectId: handle })) as {
        node?: { backendNodeId?: number };
      };
      const backendNodeId = described.node?.backendNodeId;
      if (backendNodeId === undefined) {
        throw new Error("the control could not be found");
      }
      await send("DOM.setFileInputFiles", { files, backendNodeId });
    },

    close() {
      // The window may already be destroyed when this runs (its own closed event); then there is nothing to detach.
      try {
        if (debuggerApi.isAttached()) {
          debuggerApi.detach();
        }
      } catch {
        // Already detached with the window.
      }
      contexts.clear();
    },
  };
}
