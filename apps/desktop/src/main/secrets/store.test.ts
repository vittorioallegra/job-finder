// protects=keys are stored in the app's rows without the system keychain, read back in main, reported to the renderer only as set or not set, and a key encrypted by an earlier version reads as not set until it is saved again;
// fails_when=a stored key is not read back, status carries a value, a cleared key still reads as set, or an old keychain row is passed off as a key;
// no_claim=the database adapter is covered by the repository tests; file permissions of the data folder are the operating system's.
import { describe, expect, it } from "vitest";
import { createSecretStore, secretRowKey } from "./store";

function memoryRows(initial: Record<string, string> = {}) {
  const rows = new Map(Object.entries(initial));
  return {
    rows,
    read: async (key: string) => rows.get(key) ?? null,
    write: async (key: string, value: string) => void rows.set(key, value),
    remove: async (key: string) => void rows.delete(key),
  };
}

describe("secret store", () => {
  it("stores a key, reads it back in main and reports only that it is set", async () => {
    const rows = memoryRows();
    const store = createSecretStore({ rows });
    const status = await store.set("search.tavily", "tvly-secret-value");
    expect(await store.read("search.tavily")).toBe("tvly-secret-value");
    expect(status.keys["search.tavily"]).toBe(true);
    expect(status.keys["ai.apiKey.openai"]).toBe(false);
    expect(JSON.stringify(status)).not.toContain("tvly-secret-value");
  });

  it("forgets a cleared key", async () => {
    const store = createSecretStore({ rows: memoryRows() });
    await store.set("ai.apiKey.openai", "sk-test");
    const status = await store.clear("ai.apiKey.openai");
    expect(status.keys["ai.apiKey.openai"]).toBe(false);
    expect(await store.read("ai.apiKey.openai")).toBeNull();
  });

  it("treats a key encrypted with the keychain by an earlier version as not set", async () => {
    const rows = memoryRows({ [secretRowKey("search.tavily")]: "djEwAAAAciphertext==" });
    const store = createSecretStore({ rows });
    expect(await store.read("search.tavily")).toBeNull();
    expect((await store.status()).keys["search.tavily"]).toBe(false);
    await store.set("search.tavily", "tvly-new");
    expect(await store.read("search.tavily")).toBe("tvly-new");
  });
});
