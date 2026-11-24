import { LEGACY_AI_KEY_ROW, aiKeyNameFor, type AiProvider } from "@job-finder/bridge";
import { secretRowKey, type SecretRows, type SecretStore } from "../secrets/store";

/**
 * The key for the saved AI provider, read in main and handed only to the engine. Each provider has
 * its own key, so switching provider never sends one provider's key to another; Ollama gets none.
 */
export async function readAiKey(
  secrets: Pick<SecretStore, "read">,
  ai: { provider: AiProvider; baseUrl: string },
): Promise<string | null> {
  const name = aiKeyNameFor(ai);
  return name === null ? null : secrets.read(name);
}

/**
 * Earlier versions kept one AI key for every provider. It belongs to the provider saved at the
 * time, so its encrypted row moves to that provider's key (no decryption needed). Under Ollama it
 * is dropped, since Ollama takes no key. A key already saved for that provider is kept.
 */
export async function migrateLegacyAiKey(
  rows: SecretRows,
  ai: { provider: AiProvider; baseUrl: string },
): Promise<void> {
  const cipher = await rows.read(LEGACY_AI_KEY_ROW);
  if (cipher === null) return;
  const name = aiKeyNameFor(ai);
  if (name !== null && (await rows.read(secretRowKey(name))) === null) {
    await rows.write(secretRowKey(name), cipher);
  }
  await rows.remove(LEGACY_AI_KEY_ROW);
}
