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
  /** Consecutive crashes (without a successful ping in between) before giving up. */
  maxRestarts?: number;
}

export interface EngineSupervisor {
  /** Resolves once the current engine answers a ping; waits through restarts. */
  ping(): Promise<void>;
  stop(): void;
}

interface PendingPing {
  resolve: () => void;
  reject: (error: Error) => void;
}

interface Current {
  handle: EngineHandle;
  ready: boolean;
  pendingPings: Map<number, PendingPing>;
}

/**
 * Keeps one engine utility process alive. Serves its database requests, restarts it after a
 * crash with a logged reason, and reconciles runs it left `running`.
 */
export function startEngineSupervisor(options: EngineSupervisorOptions): EngineSupervisor {
  const restartDelayMs = options.restartDelayMs ?? 1_000;
  const maxRestarts = options.maxRestarts ?? 5;
  let current: Current | null = null;
  let consecutiveCrashes = 0;
  let stopped = false;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let nextPingId = 1;
  let readyWaiters: Array<() => void> = [];

  function spawn(): void {
    if (stopped) {
      return;
    }
    const handle = options.launch();
    const state: Current = { handle, ready: false, pendingPings: new Map() };
    current = state;
    handle.port.on("message", (data) => onMessage(state, data as EngineToMainMessage));
    handle.port.start();
    handle.onExit((code) => onExit(state, code));
    sendPing(state, () => {
      state.ready = true;
      consecutiveCrashes = 0;
      options.log("info", "engine ready");
      const waiters = readyWaiters;
      readyWaiters = [];
      waiters.forEach((resolve) => resolve());
    });
  }

  function sendPing(
    state: Current,
    resolve: () => void,
    reject: (error: Error) => void = () => {},
  ): void {
    const id = nextPingId;
    nextPingId += 1;
    state.pendingPings.set(id, { resolve, reject });
    state.handle.port.postMessage({ type: "ping", id });
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
    }
  }

  function onExit(state: Current, code: number): void {
    if (state !== current) {
      return;
    }
    current = null;
    state.handle.port.close();
    for (const pending of state.pendingPings.values()) {
      pending.reject(new Error(`engine exited with code ${code}`));
    }
    state.pendingPings.clear();
    if (stopped) {
      return;
    }
    consecutiveCrashes += 1;
    void options.database.reconcileInterruptedRuns().then((count) => {
      options.log("error", `engine exited with code ${code}; ${count} run(s) marked interrupted`);
      if (consecutiveCrashes > maxRestarts) {
        options.log("error", `engine crashed ${consecutiveCrashes} times in a row; not restarting`);
        return;
      }
      const delay = restartDelayMs * 2 ** (consecutiveCrashes - 1);
      options.log("warn", `restarting engine in ${delay} ms (crash ${consecutiveCrashes})`);
      restartTimer = setTimeout(spawn, delay);
    });
  }

  spawn();

  return {
    async ping() {
      while (!current?.ready) {
        await new Promise<void>((resolve) => readyWaiters.push(resolve));
      }
      const state = current;
      await new Promise<void>((resolve, reject) => sendPing(state, resolve, reject));
    },
    stop() {
      stopped = true;
      clearTimeout(restartTimer);
      const state = current;
      current = null;
      state?.handle.stop();
      state?.handle.port.close();
    },
  };
}
