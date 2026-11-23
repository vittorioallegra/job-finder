import type { AiConnectionResult, AiProviderConfig } from "@job-finder/core/ai";
import type { CvImportOutcome, CvImportRequest } from "@job-finder/core/cv";
import type { DbCall, DbResult, EngineToMainMessage } from "../../engine/protocol";
import type { PortLike } from "../../engine/port";

export type LogLevel = "info" | "warn" | "error";

/** One running engine process, seen from main. */
export interface EngineHandle {
  readonly port: PortLike;
  onExit(listener: (code: number) => void): void;
  stop(): void;
}

/** The database operations the supervisor needs from main. */
export interface EngineDatabase {
  execute(calls: DbCall[]): Promise<DbResult[]>;
  reconcileInterruptedRuns(): Promise<number>;
}

export interface EngineSupervisorOptions {
  launch: () => EngineHandle;
  database: EngineDatabase;
  log: (level: LogLevel, message: string) => void;
  /** Delay before the first restart; doubles per consecutive crash. */
  restartDelayMs?: number;
  /**
   * Restarts allowed after consecutive crashes (no successful ping in between). The crash after
   * the last allowed restart is terminal: with 5, the 6th consecutive crash gives up.
   */
  maxRestarts?: number;
}

/**
 * `running` while an engine process exists, `restarting` between a crash and the next spawn,
 * `failed` once the supervisor has given up restarting.
 */
export type EngineSupervisorState = "running" | "restarting" | "failed";

/**
 * Why a call could not reach the engine: it crashed while the call was in flight, the
 * supervisor gave up restarting it, or the supervisor was stopped.
 */
export type EngineUnavailableReason = "crashed" | "gave_up" | "stopped";

export class EngineUnavailableError extends Error {
  readonly reason: EngineUnavailableReason;

  constructor(reason: EngineUnavailableReason) {
    super(`engine unavailable: ${reason}`);
    this.name = "EngineUnavailableError";
    this.reason = reason;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface EngineSupervisor {
  /** Resolves once the current engine answers a ping; waits through restarts. */
  ping(): Promise<void>;
  /**
   * Runs an AI connection test in the engine. The config carries the API key, so it is sent to
   * the engine only and never logged or returned to the renderer.
   */
  testAiConnection(config: AiProviderConfig): Promise<AiConnectionResult>;
  /** Runs a CV import in the engine. The request carries the key and the CV bytes; neither is logged. */
  importCv(request: CvImportRequest): Promise<CvImportOutcome>;
  readonly state: EngineSupervisorState;
  stop(): void;
}

interface Pending {
  resolve: () => void;
  reject: (error: Error) => void;
}

interface PendingAiTest {
  resolve: (result: AiConnectionResult) => void;
  reject: (error: Error) => void;
}

interface PendingCvImport {
  resolve: (outcome: CvImportOutcome) => void;
  reject: (error: Error) => void;
}

interface Current {
  handle: EngineHandle;
  ready: boolean;
  pendingPings: Map<number, Pending>;
  pendingAiTests: Map<number, PendingAiTest>;
  pendingCvImports: Map<number, PendingCvImport>;
}

/**
 * Keeps one engine utility process alive. Serves its database requests, restarts it after a
 * crash with a logged reason, and reconciles runs it left `running`. Calls never hang: in-flight
 * calls reject when the engine crashes, and calls made after the supervisor gave up or was
 * stopped reject at once.
 */
export function startEngineSupervisor(options: EngineSupervisorOptions): EngineSupervisor {
  const restartDelayMs = options.restartDelayMs ?? 1_000;
  const maxRestarts = options.maxRestarts ?? 5;
  let current: Current | null = null;
  let consecutiveCrashes = 0;
  let phase: EngineSupervisorState = "running";
  let stopped = false;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let nextRequestId = 1;
  let readyWaiters: Pending[] = [];

  function spawn(): void {
    if (stopped) {
      return;
    }
    const handle = options.launch();
    const state: Current = {
      handle,
      ready: false,
      pendingPings: new Map(),
      pendingAiTests: new Map(),
      pendingCvImports: new Map(),
    };
    current = state;
    phase = "running";
    handle.port.on("message", (data) => onMessage(state, data as EngineToMainMessage));
    handle.port.start();
    handle.onExit((code) => onExit(state, code));
    sendPing(state, () => {
      state.ready = true;
      consecutiveCrashes = 0;
      options.log("info", "engine ready");
      const waiters = readyWaiters;
      readyWaiters = [];
      waiters.forEach((waiter) => waiter.resolve());
    });
  }

  function sendPing(
    state: Current,
    resolve: () => void,
    reject: (error: Error) => void = () => {},
  ): void {
    const id = nextRequestId;
    nextRequestId += 1;
    state.pendingPings.set(id, { resolve, reject });
    state.handle.port.postMessage({ type: "ping", id });
  }

  function rejectPending(state: Current, reason: EngineUnavailableReason): void {
    for (const pending of state.pendingPings.values()) {
      pending.reject(new EngineUnavailableError(reason));
    }
    state.pendingPings.clear();
    for (const pending of state.pendingAiTests.values()) {
      pending.reject(new EngineUnavailableError(reason));
    }
    state.pendingAiTests.clear();
    for (const pending of state.pendingCvImports.values()) {
      pending.reject(new EngineUnavailableError(reason));
    }
    state.pendingCvImports.clear();
  }

  function rejectReadyWaiters(reason: EngineUnavailableReason): void {
    const waiters = readyWaiters;
    readyWaiters = [];
    waiters.forEach((waiter) => waiter.reject(new EngineUnavailableError(reason)));
  }

  function onMessage(state: Current, message: EngineToMainMessage): void {
    if (state !== current) {
      return;
    }
    if (message.type === "pong") {
      const pending = state.pendingPings.get(message.id);
      state.pendingPings.delete(message.id);
      pending?.resolve();
      return;
    }
    if (message.type === "db") {
      void options.database.execute(message.calls).then((results) => {
        if (state === current) {
          state.handle.port.postMessage({ type: "db-result", id: message.id, results });
        }
      });
      return;
    }
    if (message.type === "ai-test-result") {
      const pending = state.pendingAiTests.get(message.id);
      state.pendingAiTests.delete(message.id);
      pending?.resolve(message.result);
      return;
    }
    if (message.type === "cv-import-result") {
      const pending = state.pendingCvImports.get(message.id);
      state.pendingCvImports.delete(message.id);
      pending?.resolve(message.outcome);
    }
  }

  function onExit(state: Current, code: number): void {
    if (state !== current) {
      return;
    }
    current = null;
    state.handle.port.close();
    rejectPending(state, "crashed");
    if (stopped) {
      return;
    }
    consecutiveCrashes += 1;
    phase = "restarting";
    // A reconcile failure is logged and must not block recovery: restart or give-up still runs.
    const reconciled = options.database.reconcileInterruptedRuns().then(
      (count) => `${count} run(s) marked interrupted`,
      (error: unknown) => `reconciling runs failed: ${describeError(error)}`,
    );
    void reconciled.then((summary) => {
      options.log("error", `engine exited with code ${code}; ${summary}`);
      if (stopped) {
        return;
      }
      if (consecutiveCrashes > maxRestarts) {
        phase = "failed";
        options.log("error", `engine crashed ${consecutiveCrashes} times in a row; not restarting`);
        rejectReadyWaiters("gave_up");
        return;
      }
      const delay = restartDelayMs * 2 ** (consecutiveCrashes - 1);
      options.log("warn", `restarting engine in ${delay} ms (crash ${consecutiveCrashes})`);
      restartTimer = setTimeout(spawn, delay);
    });
  }

  spawn();

  /** Resolves with the engine that is ready to take requests; waits through restarts. */
  async function waitUntilReady(): Promise<Current> {
    let target = current;
    while (!target?.ready) {
      if (stopped) {
        throw new EngineUnavailableError("stopped");
      }
      if (phase === "failed") {
        throw new EngineUnavailableError("gave_up");
      }
      await new Promise<void>((resolve, reject) => readyWaiters.push({ resolve, reject }));
      target = current;
    }
    return target;
  }

  // A ready engine gets the request in the same tick, so a crash right after the call still finds it pending.
  return {
    async ping() {
      const ready = current?.ready ? current : await waitUntilReady();
      await new Promise<void>((resolve, reject) => sendPing(ready, resolve, reject));
    },
    async testAiConnection(config) {
      const ready = current?.ready ? current : await waitUntilReady();
      const id = nextRequestId;
      nextRequestId += 1;
      return new Promise<AiConnectionResult>((resolve, reject) => {
        ready.pendingAiTests.set(id, { resolve, reject });
        ready.handle.port.postMessage({ type: "ai-test", id, config });
      });
    },
    async importCv(request) {
      const ready = current?.ready ? current : await waitUntilReady();
      const id = nextRequestId;
      nextRequestId += 1;
      return new Promise<CvImportOutcome>((resolve, reject) => {
        ready.pendingCvImports.set(id, { resolve, reject });
        ready.handle.port.postMessage({ type: "cv-import", id, request });
      });
    },
    get state() {
      return phase;
    },
    stop() {
      stopped = true;
      clearTimeout(restartTimer);
      rejectReadyWaiters("stopped");
      const stoppedEngine = current;
      current = null;
      if (stoppedEngine) {
        rejectPending(stoppedEngine, "stopped");
        stoppedEngine.handle.stop();
        stoppedEngine.handle.port.close();
      }
    },
  };
}
