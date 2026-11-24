import { eq } from "drizzle-orm";
import { settings } from "@job-finder/core";
import { SECRET_NAMES, type SecretName, type SecretsStatus } from "@job-finder/bridge";
import type { AppDb } from "../db/operations";

/** Where secrets are kept. The production adapter is the shared settings table. */
export interface SecretRows {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface SecretStoreOptions {
  rows: SecretRows;
}

export interface SecretStore {
  /** Renderer-facing status: set / not set per key. Never a value. */
  status(): Promise<SecretsStatus>;
  set(name: SecretName, value: string): Promise<SecretsStatus>;
  clear(name: SecretName): Promise<SecretsStatus>;
  /** Main-process only (engine and AI layer). Never passed to the renderer. */
  read(name: SecretName): Promise<string | null>;
}

/** The settings row that holds a secret. */
export const secretRowKey = (name: SecretName): string => `secret.${name}`;

/**
 * Marks a stored key. Rows without it were encrypted with the system keychain by earlier
 * versions: they read as not set, and saving the key again replaces them.
 */
const PLAIN_PREFIX = "plain:";

/**
 * Keeps the API keys as plain text in the app's database, in the user's data folder. The system
 * keychain is not used, so the system never asks for a password to read them (an unsigned app
 * would be asked again after every update). The renderer only ever sees whether a key is set.
 */
export function createSecretStore(options: SecretStoreOptions): SecretStore {
  const { rows } = options;

  async function read(name: SecretName): Promise<string | null> {
    const stored = await rows.read(secretRowKey(name));
    return stored !== null && stored.startsWith(PLAIN_PREFIX)
      ? stored.slice(PLAIN_PREFIX.length)
      : null;
  }

  async function status(): Promise<SecretsStatus> {
    const keys = {} as Record<SecretName, boolean>;
    for (const name of SECRET_NAMES) {
      keys[name] = (await read(name)) !== null;
    }
    return { keys };
  }

  return {
    status,
    read,
    async set(name, value) {
      await rows.write(secretRowKey(name), `${PLAIN_PREFIX}${value}`);
      return status();
    },
    async clear(name) {
      await rows.remove(secretRowKey(name));
      return status();
    },
  };
}

/** Production adapter: secrets are rows in the shared settings table, keyed `secret.<name>`. */
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
