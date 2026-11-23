// protects=secrets are encrypted on disk when safeStorage is available, kept in memory only when it is not, Linux basic_text is written only after the opt-in, and the renderer-facing status never carries a value;
// fails_when=a key is written in plain text, written to disk without the opt-in, reported as set after clear, or returned by status;
// no_claim=the real OS keychain and its prompts are not exercised here; the fake safeStorage only checks the call contract.
import { describe, expect, it } from "vitest";
import { createSecretStore, resolveSecretStorage, type SafeStorageLike } from "./store";

function fakeSafeStorage(options: { available?: boolean; backend?: string } = {}): SafeStorageLike {
  return {
    isEncryptionAvailable: () => options.available ?? true,
    encryptString: (plainText) => Buffer.from(`enc:${plainText}`, "utf8"),
    decryptString: (encrypted) => encrypted.toString("utf8").replace(/^enc:/, ""),
    ...(options.backend === undefined
      ? {}
      : { getSelectedStorageBackend: () => options.backend as string }),
  };
}

function memoryRows() {
  const rows = new Map<string, string>();
  return {
    rows,
    read: async (key: string) => rows.get(key) ?? null,
    write: async (key: string, value: string) => void rows.set(key, value),
    remove: async (key: string) => void rows.delete(key),
  };
}

function storeWith(options: {
  safeStorage: SafeStorageLike;
  basicTextAllowed?: boolean;
  rows?: ReturnType<typeof memoryRows>;
}) {
  const rows = options.rows ?? memoryRows();
  const store = createSecretStore({
    safeStorage: options.safeStorage,
    rows,
    isBasicTextAllowed: async () => options.basicTextAllowed ?? false,
  });
  return { store, rows };
}

describe("secret store", () => {
  it("writes an encrypted blob, not the plain key, when encryption is available", async () => {
    const { store, rows } = storeWith({ safeStorage: fakeSafeStorage() });
    await store.set("ai.apiKey", "sk-test-value");
    const stored = [...rows.rows.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0]).not.toContain("sk-test-value");
    expect(await store.read("ai.apiKey")).toBe("sk-test-value");
    expect((await store.status()).storage).toEqual({ mode: "encrypted", optInRequired: false });
  });

  it("reports set or not set per key and never the value", async () => {
    const { store } = storeWith({ safeStorage: fakeSafeStorage() });
    await store.set("search.brave", "brave-secret-value");
    const status = await store.status();
    expect(status.keys["search.brave"]).toBe(true);
    expect(status.keys["ai.apiKey"]).toBe(false);
    expect(JSON.stringify(status)).not.toContain("brave-secret-value");
  });

  it("keeps keys in memory only when encryption is unavailable", async () => {
    const { store, rows } = storeWith({ safeStorage: fakeSafeStorage({ available: false }) });
    await store.set("search.tavily", "tavily-value");
    expect(rows.rows.size).toBe(0);
    expect(await store.read("search.tavily")).toBe("tavily-value");
    expect((await store.status()).storage.mode).toBe("session-only");
  });

  it("does not write basic_text keys to disk before the Linux opt-in", async () => {
    const safeStorage = fakeSafeStorage({ backend: "basic_text" });
    const { store, rows } = storeWith({ safeStorage, basicTextAllowed: false });
    await store.set("ai.apiKey", "sk-linux-value");
    expect(rows.rows.size).toBe(0);
    const status = await store.status();
    expect(status.storage).toEqual({ mode: "session-only", optInRequired: true });
    expect(status.keys["ai.apiKey"]).toBe(true);
  });

  it("moves in-memory keys to disk once the opt-in is granted", async () => {
    const safeStorage = fakeSafeStorage({ backend: "basic_text" });
    let allowed = false;
    const rows = memoryRows();
    const store = createSecretStore({
      safeStorage,
      rows,
      isBasicTextAllowed: async () => allowed,
    });
    await store.set("ai.apiKey", "sk-linux-value");
    expect(rows.rows.size).toBe(0);
    allowed = true;
    await store.onBasicTextAllowedChanged();
    expect(rows.rows.size).toBe(1);
    expect(await store.read("ai.apiKey")).toBe("sk-linux-value");
  });

  it("removes both the memory copy and the disk blob on clear", async () => {
    const { store, rows } = storeWith({ safeStorage: fakeSafeStorage() });
    await store.set("ai.apiKey", "sk-test-value");
    const status = await store.clear("ai.apiKey");
    expect(status.keys["ai.apiKey"]).toBe(false);
    expect(rows.rows.size).toBe(0);
    expect(await store.read("ai.apiKey")).toBeNull();
  });
});

describe("resolveSecretStorage", () => {
  it("treats an unknown backend as session-only and macOS-style encryption as encrypted", () => {
    expect(resolveSecretStorage(fakeSafeStorage({ backend: "unknown" }), true).mode).toBe(
      "session-only",
    );
    expect(resolveSecretStorage(fakeSafeStorage(), false)).toEqual({
      mode: "encrypted",
      optInRequired: false,
    });
  });
});
