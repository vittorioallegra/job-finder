import type { IngestEvent } from "@job-finder/core/ingest/events";
import type { IngestStartResult } from "@job-finder/bridge";
import type { IngestAiSettings } from "../../engine/protocol";

/** The part of the engine supervisor the ingestion service needs. */
export interface IngestionEngine {
  startIngestion(
    runId: string,
    companyId?: string,
    ai?: IngestAiSettings,
  ): Promise<"accepted" | "already-running">;
  cancelIngestion(runId: string): void;
}

export interface IngestionServiceOptions {
  /** The current engine, or null while none is running. */
  engine: () => IngestionEngine | null;
  /** Sends a progress event to the renderer windows. */
  broadcast: (event: IngestEvent) => void;
  /**
   * The AI provider for generic careers pages, read when a run starts: settings plus the saved key.
   * Omitted or rejected: the run goes ahead without AI, and generic careers pages fail with `ai-unavailable`.
   */
  aiSettings?: () => Promise<IngestAiSettings | undefined>;
  newRunId?: () => string;
}

export interface IngestionService {
  /** Starts a run over every company, or over `companyId` only. */
  start(companyId?: string): Promise<IngestStartResult>;
  cancel(runId: string): void;
  /** Progress from the engine: forwarded to the windows, and a finished run stops being active. */
  handleEngineEvent(event: IngestEvent): void;
  /** The engine process died: an active run is reported as interrupted. Its row is reconciled by the supervisor. */
  handleEngineLost(): void;
}

/** Seq of a progress event that is not in the run log (the run never wrote its own). */
const UNSTORED_SEQ = -1;

async function loadAiSettings(
  load: IngestionServiceOptions["aiSettings"],
): Promise<IngestAiSettings | undefined> {
  if (!load) return undefined;
  try {
    return await load();
  } catch {
    return undefined;
  }
}

/** Runs one ingestion at a time from the renderer's request to the engine and back. */
export function createIngestionService(options: IngestionServiceOptions): IngestionService {
  const newRunId = options.newRunId ?? (() => crypto.randomUUID());
  let activeRunId: string | undefined;

  return {
    async start(companyId) {
      if (activeRunId !== undefined) {
        return { ok: false, code: "already-running" };
      }
      const engine = options.engine();
      if (!engine) {
        return { ok: false, code: "engine-unavailable" };
      }
      const runId = newRunId();
      const ai = await loadAiSettings(options.aiSettings);
      let answer: "accepted" | "already-running";
      try {
        answer = await engine.startIngestion(runId, companyId, ai);
      } catch {
        return { ok: false, code: "engine-unavailable" };
      }
      if (answer === "already-running") {
        return { ok: false, code: "already-running" };
      }
      activeRunId = runId;
      return { ok: true, runId };
    },

    cancel(runId) {
      options.engine()?.cancelIngestion(runId);
    },

    handleEngineEvent(event) {
      options.broadcast(event);
      if (event.kind === "run-finished" && event.runId === activeRunId) {
        activeRunId = undefined;
      }
    },

    handleEngineLost() {
      if (activeRunId === undefined) return;
      const runId = activeRunId;
      activeRunId = undefined;
      options.broadcast({
        runId,
        seq: UNSTORED_SEQ,
        at: Date.now(),
        kind: "run-finished",
        status: "interrupted",
      });
    },
  };
}
