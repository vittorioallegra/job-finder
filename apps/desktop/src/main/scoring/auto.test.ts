// protects=a scan that succeeded and found new jobs starts the scoring by itself when the AI is on and the user already agreed (or it runs on this computer), sending the saved consent; nothing starts with the AI off, without consent, after a failed scan, or when no job is new, and a failing scoring never throws;
// fails_when=the AI is called with the AI off or without the stored consent, a scan that found nothing scores, a failed or cancelled scan scores, the consent is not sent, or an error escapes into the scan's end;
// no_claim=the scoring itself, which its own tests cover, and which jobs a scan finds, which the ingest tests cover;
import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS, aiConsentTarget, type AppSettings } from "@job-finder/bridge";
import { createAutoScoring } from "./auto";

function setup(options: {
  ai?: Partial<AppSettings["ai"]>;
  newJobs?: number;
  scoring?: () => Promise<unknown>;
}) {
  const started: unknown[] = [];
  const logs: string[] = [];
  const auto = createAutoScoring({
    settings: {
      get: async () => ({
        ...DEFAULT_APP_SETTINGS,
        ai: {
          ...DEFAULT_APP_SETTINGS.ai,
          enabled: true,
          provider: "anthropic",
          model: "m",
          ...options.ai,
        },
      }),
    },
    scoring: {
      start: async (request) => {
        started.push(request);
        return (
          options.scoring
            ? await options.scoring()
            : { ok: true, scored: 3, cached: 1, failed: 0, skipped: 0 }
        ) as never;
      },
    },
    newJobsOf: async () => options.newJobs ?? 5,
    log: (_level, message) => logs.push(message),
  });
  return { auto, started, logs };
}

describe("auto scoring", () => {
  it("scores after a successful scan that found new jobs, with the consent saved for the provider", async () => {
    const consentTarget = aiConsentTarget({ provider: "anthropic", baseUrl: "" });
    const { auto, started, logs } = setup({ ai: { consentTarget } });

    await auto.handleRunFinished("r1", "succeeded");

    expect(started).toEqual([{ consent: true, consentTarget }]);
    expect(logs[0]).toContain("3 new");
  });

  it("scores with a model on this computer, which needs no consent", async () => {
    const { auto, started } = setup({
      ai: { provider: "openai-compatible", baseUrl: "http://localhost:11434/v1" },
    });
    await auto.handleRunFinished("r1", "succeeded");
    expect(started).toHaveLength(1);
  });

  it("does nothing with the AI off, without the stored consent, after a failed or cancelled scan, or when no job is new", async () => {
    const consentTarget = aiConsentTarget({ provider: "anthropic", baseUrl: "" });
    const off = setup({ ai: { enabled: false, consentTarget } });
    await off.auto.handleRunFinished("r", "succeeded");
    const noConsent = setup({});
    await noConsent.auto.handleRunFinished("r", "succeeded");
    const failed = setup({ ai: { consentTarget } });
    await failed.auto.handleRunFinished("r", "failed");
    await failed.auto.handleRunFinished("r", "cancelled");
    await failed.auto.handleRunFinished("r", "interrupted");
    const nothingNew = setup({ ai: { consentTarget }, newJobs: 0 });
    await nothingNew.auto.handleRunFinished("r", "succeeded");

    for (const run of [off, noConsent, failed, nothingNew]) expect(run.started).toEqual([]);
  });

  it("reports a failed or throwing scoring in the log and never throws", async () => {
    const consentTarget = aiConsentTarget({ provider: "anthropic", baseUrl: "" });
    const refused = setup({
      ai: { consentTarget },
      scoring: async () => ({ ok: false, code: "already-running" }),
    });
    await refused.auto.handleRunFinished("r", "succeeded");
    expect(refused.logs[0]).toContain("already-running");

    const broken = setup({
      ai: { consentTarget },
      scoring: async () => {
        throw new Error("boom");
      },
    });
    await expect(broken.auto.handleRunFinished("r", "succeeded")).resolves.toBeUndefined();
    expect(broken.logs[0]).toContain("boom");
  });
});
