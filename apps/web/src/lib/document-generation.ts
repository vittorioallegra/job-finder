import { useSyncExternalStore } from "react";
import type {
  DocumentFailureCode,
  DocumentKind,
  DocumentLanguage,
  DocumentRecord,
  JobFinderBridge,
} from "@job-finder/bridge";
import { useBridge } from "./bridge/BridgeContext";

/** What a finished run produced: the documents it wrote, and the failure that stopped it, if any. */
export interface GenerationResult {
  records: DocumentRecord[];
  failure: { kind: DocumentKind; code: DocumentFailureCode } | null;
}

export interface GenerationState {
  /** The kind being written now, or null when no run is active. */
  running: DocumentKind | null;
  /** Counts finished runs, so a screen can tell a new result from one it already shows. */
  version: number;
  last: GenerationResult | null;
}

const IDLE: GenerationState = { running: null, version: 0, last: null };

/**
 * Writing a CV and a letter takes a while, and the user may leave the screen meanwhile. The run
 * lives here, outside any screen, so it goes on, and a screen opened later shows it running or
 * shows its result. One store per bridge; one run at a time per application.
 */
const stores = new WeakMap<JobFinderBridge, Map<string, GenerationState>>();
const listeners = new Set<() => void>();

function storeOf(bridge: JobFinderBridge): Map<string, GenerationState> {
  let store = stores.get(bridge);
  if (!store) {
    store = new Map();
    stores.set(bridge, store);
  }
  return store;
}

function publish(bridge: JobFinderBridge, applicationId: string, state: GenerationState) {
  storeOf(bridge).set(applicationId, state);
  for (const listener of listeners) listener();
}

async function setStatus(
  bridge: JobFinderBridge,
  applicationId: string,
  status: "preparing" | "ready",
): Promise<void> {
  try {
    await bridge.applications.update({ applicationId, status });
  } catch {
    // The history is a record, not a requirement.
  }
}

/**
 * Writes the documents one after the other. A failure stops the run, since the next call would fail
 * the same way. Resolves with the result, or null when a run for this application is already going.
 */
export async function startGeneration(
  bridge: JobFinderBridge,
  applicationId: string,
  kinds: readonly DocumentKind[],
  language?: DocumentLanguage,
): Promise<GenerationResult | null> {
  const store = storeOf(bridge);
  if ((store.get(applicationId) ?? IDLE).running !== null) return null;

  const result: GenerationResult = { records: [], failure: null };
  // The history shows the work: "in preparation" now, "ready" when it is done. Refused moves (an
  // application already sent) are fine: the documents are still written.
  await setStatus(bridge, applicationId, "preparing");
  for (const kind of kinds) {
    publish(bridge, applicationId, { ...(store.get(applicationId) ?? IDLE), running: kind });
    try {
      const answer = await bridge.documents.generate({
        applicationId,
        kind,
        ...(language ? { language } : {}),
      });
      if (answer.ok) {
        result.records.push(answer.document);
      } else {
        result.failure = { kind, code: answer.code };
      }
    } catch {
      result.failure = { kind, code: "unknown" };
    }
    if (result.failure) break;
  }
  if (result.records.length > 0) await setStatus(bridge, applicationId, "ready");
  const previous = store.get(applicationId) ?? IDLE;
  publish(bridge, applicationId, { running: null, version: previous.version + 1, last: result });
  return result;
}

/** The generation state of one application, kept up to date. */
export function useGeneration(applicationId: string): GenerationState {
  const bridge = useBridge();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => storeOf(bridge).get(applicationId) ?? IDLE,
  );
}
