import type { MessagePortMain } from "electron";

/** The subset of a message port the engine and supervisor use. Test ports implement it too. */
export interface PortLike {
  postMessage(message: unknown): void;
  on(event: "message", listener: (data: unknown) => void): void;
  start(): void;
  close(): void;
}

/** Adapts an Electron `MessagePortMain` (whose events carry `.data`) to `PortLike`. */
export function fromElectronPort(port: MessagePortMain): PortLike {
  return {
    postMessage: (message) => port.postMessage(message),
    on: (_event, listener) => port.on("message", (event) => listener(event.data)),
    start: () => port.start(),
    close: () => port.close(),
  };
}
