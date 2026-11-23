// protects=the form window's DevTools session sends only the allowed commands (no Input domain, so no key press or click), lists the default context of each frame, reports a page script that throws, and detaches once;
// fails_when=a command outside the allow list is sent, an Input or key command goes out, an isolated world is taken for a frame, a script error is returned as a value, or a second close detaches again;
// no_claim=the protocol replies are scripted; that Chromium accepts these commands on a real form is checked by the Electron end-to-end test;
import { describe, expect, it, vi } from "vitest";
import { ALLOWED_CDP_METHODS, openCdpSession, type DebuggerLike } from "./cdp";

type Listener = (event: unknown, method: string, params: Record<string, unknown>) => void;

function fakeDebugger(replies: Record<string, unknown> = {}) {
  const listeners: Listener[] = [];
  const sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
  let attached = false;
  const api: DebuggerLike = {
    attach: vi.fn(() => {
      attached = true;
    }),
    isAttached: () => attached,
    detach: vi.fn(() => {
      attached = false;
    }),
    sendCommand: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      sent.push({ method, params });
      const reply = replies[method];
      return typeof reply === "function" ? reply(params) : (reply ?? {});
    }),
    on: (_event, listener) => {
      listeners.push(listener as Listener);
      return api;
    },
  };
  const emit = (method: string, params: Record<string, unknown>) =>
    listeners.forEach((listener) => listener({}, method, params));
  return { api, sent, emit };
}

describe("form window DevTools session", () => {
  it("sends only allowed commands, and never the Input domain", async () => {
    const fake = fakeDebugger({ "DOM.describeNode": { node: { backendNodeId: 7 } } });
    const session = openCdpSession(fake.api);
    await session.open();
    await session.setFiles("handle-1", ["/tmp/cv.pdf"]);

    const methods = fake.sent.map((command) => command.method);
    expect(
      methods.every((method) => (ALLOWED_CDP_METHODS as readonly string[]).includes(method)),
    ).toBe(true);
    expect(methods.some((method) => method.startsWith("Input."))).toBe(false);
    expect(fake.sent).toContainEqual({
      method: "DOM.setFileInputFiles",
      params: { files: ["/tmp/cv.pdf"], backendNodeId: 7 },
    });
  });

  it("lists the default context of each frame and ignores isolated worlds", async () => {
    const fake = fakeDebugger();
    const session = openCdpSession(fake.api);
    fake.emit("Runtime.executionContextCreated", {
      context: { id: 3, auxData: { frameId: "main", isDefault: true } },
    });
    fake.emit("Runtime.executionContextCreated", {
      context: { id: 4, auxData: { frameId: "extension", isDefault: false } },
    });
    fake.emit("Runtime.executionContextCreated", {
      context: { id: 5, auxData: { frameId: "iframe", isDefault: true } },
    });
    fake.emit("Runtime.executionContextDestroyed", { executionContextId: 5 });

    expect(await session.open()).toEqual([{ id: 3, frameId: "main" }]);
  });

  it("reports a page script that throws as an error, not as a value", async () => {
    const fake = fakeDebugger({
      "Runtime.evaluate": { result: { value: undefined }, exceptionDetails: { text: "boom" } },
    });
    const session = openCdpSession(fake.api);

    await expect(session.evaluate(3, "(() => { throw new Error('x') })()")).rejects.toThrow(
      "page script failed",
    );
  });

  it("detaches once, and attaches with protocol 1.3 on open", async () => {
    const fake = fakeDebugger();
    const session = openCdpSession(fake.api);
    await session.open();
    expect(fake.api.attach).toHaveBeenCalledWith("1.3");

    session.close();
    session.close();
    expect(fake.api.detach).toHaveBeenCalledTimes(1);
  });
});
