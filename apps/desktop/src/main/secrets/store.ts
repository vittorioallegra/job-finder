import { eq } from "drizzle-orm";
import { settings } from "@job-finder/core";
import {
  SECRET_NAMES,
  type SecretName,
  type SecretsStatus,
  type SecretStorageInfo,
} from "@job-finder/bridge";
import type { AppDb } from "../db/operations";

/** The part of Electron's `safeStorage` this module uses. Tests pass a fake. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  /** Linux only: `basic_text`, `gnome_libsecret`, `kwallet`, `kwallet5`, `kwallet6` or `unknown`. */
  getSelectedStorageBackend?(): string;
}

/** Where encrypted secret blobs are kept. The production adapter is the shared settings table. */
export interface SecretRows {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface SecretStoreOptions {
  safeStorage: SafeStorageLike;
  rows: SecretRows;
  /** Whether the user opted in to keys on disk without keyring encryption (Linux `basic_text`). */
  isBasicTextAllowed(): Promise<boolean>;
}

export interface SecretStore {
  /** Renderer-facing status: storage mode and set / not set per key. Never a value. */
  status(): Promise<SecretsStatus>;
  set(name: SecretName, value: string): Promise<SecretsStatus>;
  clear(name: SecretName): Promise<SecretsStatus>;
  /** Main-process only (engine and AI layer). Never passed to the renderer. */
  read(name: SecretName): Promise<string | null>;
  /** Moves keys held in memory to disk once the Linux opt-in is granted. */
  onBasicTextAllowedChanged(): Promise<void>;
}

const rowKey = (name: SecretName): string => `secret.${name}`;

/**
 * Chooses how secrets are kept. Linux `basic_text` (no keyring) is stored on disk only after the
 * user opts in; without the opt-in, and whenever encryption is unavailable, keys stay in memory.
 */
export function resolveSecretStorage(
  safeStorage: SafeStorageLike,
  basicTextAllowed: boolean,
): SecretStorageInfo {
  const available = safeStorage.isEncryptionAvailable();
  const backend = safeStorage.getSelectedStorageBackend?.();
  if (backend === "basic_text") {
    if (!basicTextAllowed) {
      return { mode: "session-only", optInRequired: true };
    }
    return { mode: available ? "basic-text" : "session-only", optInRequired: false };
  }
  if (backend === "unknown" || !available) {
    return { mode: "session-only", optInRequired: false };
  }
  return { mode: "encrypted", optInRequired: false };
}

export function createSecretStore(options: SecretStoreOptions): SecretStore {
  const { safeStorage, rows } = options;
  const inMemory = new Map<SecretName, string>();

  async function storage(): Promise<SecretStorageInfo> {
    return resolveSecretStorage(safeStorage, await options.isBasicTextAllowed());
  }

  async function status(): Promise<SecretsStatus> {
    const info = await storage();
    const onDisk = info.mode !== "session-only";
    const keys = {} as Record<SecretName, boolean>;
    for (const name of SECRET_NAMES) {
      keys[name] = inMemory.has(name) || (onDisk && (await rows.read(rowKey(name))) !== null);
    }
    return { storage: info, keys };
  }

  async function writeToDisk(name: SecretName, value: string): Promise<void> {
    const cipher = safeStorage.encryptString(value).toString("base64");
    await rows.write(rowKey(name), cipher);
  }

  return {
    status,

    async set(name, value) {
      const info = await storage();
      if (info.mode === "session-only") {
        inMemory.set(name, value);
      } else {
        await writeToDisk(name, value);
        inMemory.delete(name);
      }
      return status();
    },

    async clear(name) {
      inMemory.delete(name);
      await rows.remove(rowKey(name));
      return status();
    },

    async read(name) {
      const held = inMemory.get(name);
      if (held !== undefined) {
        return held;
      }
      const info = await storage();
      if (info.mode === "session-only") {
        return null;
      }
      const cipher = await rows.read(rowKey(name));
      if (cipher === null) {
        return null;
      }
      return safeStorage.decryptString(Buffer.from(cipher, "base64"));
    },

    async onBasicTextAllowedChanged() {
      const info = await storage();
      if (info.mode === "session-only") {
        return;
      }
      for (const [name, value] of inMemory) {
        await writeToDisk(name, value);
        inMemory.delete(name);
      }
    },
  };
}

/** Production adapter: secret blobs are rows in the shared settings table, keyed `secret.<name>`. */
export function createSettingsSecretRows(db: AppDb): SecretRows {
  return {
    async read(key) {
      const rowsFound = await db
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, key))
        .limit(1);
      return rowsFound[0]?.value ?? null;
    },
    async write(key, value) {
      const now = Date.now();
      await db
        .insert(settings)
        .values({ key, value, updatedAt: now })
        .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } });
    },
    async remove(key) {
      await db.delete(settings).where(eq(settings.key, key));
    },
  };
}
