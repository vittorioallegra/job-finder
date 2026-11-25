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
  /** The kinds being written now: a CV and a letter can be written at the same time. */
  running: readonly DocumentKind[];
  /** Counts finished runs, so a screen can tell a new result from one it already shows. */
  version: number;
  last: GenerationResult | null;
}

const IDLE: GenerationState = { running: [], version: 0, last: null };

/**
 * Writing a CV and a letter takes a while, and the user may leave the screen meanwhile. The run
 * lives here, outside any screen, so it goes on, and a screen opened later shows it running or
 * shows its result. One store per bridge. A document is written by one run at a time; the CV and
 * the letter of one application may be written at the same time, each by its own run.
 */
const stores = new WeakMap<JobFinderBridge, Map<string, GenerationState>>();
const listeners = new Set<() => void>();

/** Runs in progress per application, and whether any of them wrote something (for the history). */
const activity = new WeakMap<JobFinderBridge, Map<string, { runs: number; wrote: boolean }>>();

function storeOf(bridge: JobFinderBridge): Map<string, GenerationState> {
  let store = stores.get(bridge);
  if (!store) {
    store = new Map();
    stores.set(bridge, store);
  }
  return store;
}

function activityOf(bridge: JobFinderBridge): Map<string, { runs: number; wrote: boolean }> {
  let map = activity.get(bridge);
  if (!map) {
    map = new Map();
    activity.set(bridge, map);
  }
  return map;
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

function current(bridge: JobFinderBridge, applicationId: string): GenerationState {
  return storeOf(bridge).get(applicationId) ?? IDLE;
}

/**
 * Writes the documents one after the other. A failure stops the run, since the next call would fail
 * the same way. Kinds already being written are left alone. Resolves with the result, or null when
 * every kind asked for is already being written.
 */
export async function startGeneration(
  bridge: JobFinderBridge,
  applicationId: string,
  kinds: readonly DocumentKind[],
  language?: DocumentLanguage,
): Promise<GenerationResult | null> {
  const wanted = kinds.filter((kind) => !current(bridge, applicationId).running.includes(kind));
  if (wanted.length === 0) return null;

  const counts = activityOf(bridge);
  const state = counts.get(applicationId) ?? { runs: 0, wrote: false };
  counts.set(applicationId, state);
  // The history shows the work: "in preparation" when the first run starts, "ready" when the last
  // one ends having written something. Refused moves (an application already sent) are fine.
  if (state.runs === 0) {
    state.wrote = false;
    await setStatus(bridge, applicationId, "preparing");
  }
  state.runs += 1;

  const result: GenerationResult = { records: [], failure: null };
  for (const kind of wanted) {
    const before = current(bridge, applicationId);
    publish(bridge, applicationId, { ...before, running: [...before.running, kind] });
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
    const after = current(bridge, applicationId);
    const rest = after.running.filter((item) => item !== kind);
    if (result.failure) {
      publish(bridge, applicationId, { ...after, running: rest });
      break;
    }
    // A kind that finished is no longer running; the result is published when the whole run ends.
    publish(bridge, applicationId, { ...after, running: rest });
  }

  if (result.records.length > 0) state.wrote = true;
  state.runs -= 1;
  if (state.runs === 0 && state.wrote) await setStatus(bridge, applicationId, "ready");
  const previous = current(bridge, applicationId);
  publish(bridge, applicationId, { ...previous, version: previous.version + 1, last: result });
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
