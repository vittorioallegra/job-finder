import type { AiConnectionResult, AiProviderConfig } from "@job-finder/core/ai";
import type { DbCall, DbResult, EngineToMainMessage, MainToEngineMessage } from "./protocol";
import type { PortLike } from "./port";

export interface EngineRuntime {
  /** Sends one batch of database calls to main and resolves with one result per call, in order. */
  db(calls: DbCall[]): Promise<DbResult[]>;
  close(): void;
}

/** Work the engine does for main that needs the network or the AI layer. */
export interface EngineServices {
  testAiConnection(config: AiProviderConfig): Promise<AiConnectionResult>;
}

/**
 * Engine side of the message port: answers pings, runs AI work and issues batched database
 * requests. Pure over `PortLike`, so it runs in a utility process and in tests alike.
 */
export function createEngineRuntime(port: PortLike, services: EngineServices): EngineRuntime {
  let nextId = 1;
  const pending = new Map<number, (results: DbResult[]) => void>();

  port.on("message", (data) => {
    const message = data as MainToEngineMessage;
    if (message.type === "ping") {
      post(port, { type: "pong", id: message.id });
      return;
    }
    if (message.type === "ai-test") {
      const { id, config } = message;
      void services
        .testAiConnection(config)
        .catch((): AiConnectionResult => ({ ok: false, code: "unknown" }))
        .then((result) => post(port, { type: "ai-test-result", id, result }));
      return;
    }
    if (message.type === "db-result") {
      pending.get(message.id)?.(message.results);
      pending.delete(message.id);
    }
  });
  port.start();

  return {
    db(calls) {
      return new Promise((resolve) => {
        const id = nextId;
        nextId += 1;
        pending.set(id, resolve);
        post(port, { type: "db", id, calls });
      });
    },
    close() {
      port.close();
    },
  };
}

function post(port: PortLike, message: EngineToMainMessage): void {
  port.postMessage(message);
}
