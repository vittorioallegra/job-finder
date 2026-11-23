// protects=the recording run writes sanitized AI exchanges for the configured provider, so later automated tests replay real responses without the key;
// fails_when=the recording contains the API key, or a run without JOB_FINDER_RECORD_AI=1 calls the provider;
// no_claim=runs only when recording is requested; the automated suite skips it, and it proves nothing about the answers' quality.
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AI_PROVIDER_KINDS, type AiProviderKind } from "./capabilities";
import { testAiConnection } from "./connection";
import { createAiModel, type AiProviderConfig } from "./provider";
import { createRecordingFetch, type FixtureEntry } from "./replay";
import { generateStructured } from "./structured";

const recording = process.env["JOB_FINDER_RECORD_AI"] === "1";

describe.skipIf(!recording)("record AI fixtures", () => {
  it("records the connection check and one structured call from the configured provider", async () => {
    const provider = (process.env["JOB_FINDER_AI_PROVIDER"] ?? "") as AiProviderKind;
    expect(AI_PROVIDER_KINDS).toContain(provider);
    const apiKey = process.env["JOB_FINDER_AI_API_KEY"] || null;
    const config: AiProviderConfig = {
      provider,
      model: process.env["JOB_FINDER_AI_MODEL"] ?? "",
      baseUrl: process.env["JOB_FINDER_AI_BASE_URL"] ?? "",
      apiKey,
    };
    const entries: FixtureEntry[] = [];
    const fetchImpl = createRecordingFetch({
      upstream: fetch,
      redact: apiKey ? [apiKey] : [],
      onRecord: (entry) => entries.push(entry),
    });

    const connection = await testAiConnection(config, { fetch: fetchImpl });
    expect(connection.ok).toBe(true);

    const { model, capabilities } = createAiModel(config, { fetch: fetchImpl });
    await generateStructured({
      model,
      capabilities,
      schema: z.strictObject({ title: z.string().min(1) }),
      prompt: 'Reply with a JSON object whose "title" is a job title for a software engineer.',
      contextSize: 8192,
    });

    const directory = new URL("./fixtures/", import.meta.url);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      new URL(`ai-${provider}.json`, directory),
      `${JSON.stringify({ provider, model: config.model, entries }, null, 2)}\n`,
    );
    expect(entries.length).toBeGreaterThan(0);
    if (apiKey) {
      expect(JSON.stringify(entries)).not.toContain(apiKey);
    }
  });
});
