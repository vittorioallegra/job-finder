import { aiKeyNameFor, type AiProvider } from "@job-finder/bridge";
import type { SecretStore } from "../secrets/store";

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
