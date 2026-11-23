import { z } from "zod";

/** Every secret the app stores. Names are fixed here; the renderer never sends arbitrary keys. */
export const SECRET_NAMES = [
  "ai.apiKey",
  "search.brave",
  "search.tavily",
  "search.serper",
] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

/**
 * How secrets are kept. `encrypted`: OS keychain via safeStorage, on disk. `basic-text`: Linux
 * without a keyring, on disk, only after the user opted in. `session-only`: memory until quit.
 */
export const SECRET_STORAGE_MODES = ["encrypted", "basic-text", "session-only"] as const;
export type SecretStorageMode = (typeof SECRET_STORAGE_MODES)[number];

export interface SecretStorageInfo {
  mode: SecretStorageMode;
  /** True when keys would be kept on disk only after the user opts in (Linux `basic_text`). */
  optInRequired: boolean;
}

/** What the renderer may see about secrets: storage mode and whether each key is set, never its value. */
export interface SecretsStatus {
  storage: SecretStorageInfo;
  keys: Record<SecretName, boolean>;
}

export const SecretSetRequestSchema = z.strictObject({
  name: z.enum(SECRET_NAMES),
  value: z.string().trim().min(1).max(4096),
});

export const SecretClearRequestSchema = z.strictObject({
  name: z.enum(SECRET_NAMES),
});
