// Pure types shared by the engine, main and the renderer bridge. No imports, so the bridge can use them without loading core.

/** Value of `runs.kind` for an ingestion run. */
export const INGEST_RUN_KIND = "ingest";

/** How a run ends on its own. `interrupted` is not set here: startup reconcile marks runs the engine never finished. */
export type IngestRunOutcome = "succeeded" | "failed" | "cancelled";

export interface IngestEventBase {
  runId: string;
  /** Position in the run, starting at 0. Events of one run are stored and shown in this order. */
  seq: number;
  /** Epoch milliseconds. */
  at: number;
}

/** Progress and run log entries. Failures carry a code (never a message); the renderer words them. */
export type IngestEvent = IngestEventBase &
  (
    | { kind: "run-started" }
    | { kind: "company-started"; companyId: string; companyName: string }
    | {
        kind: "company-scanned";
        companyId: string;
        companyName: string;
        /** Postings the complete scan read. */
        jobCount: number;
        /** Postings of this company marked closed by the scan. */
        closedCount: number;
      }
    | { kind: "company-failed"; companyId: string; companyName: string; code: string }
    | { kind: "run-finished"; status: IngestRunOutcome | "interrupted" }
  );

export type IngestEventKind = IngestEvent["kind"];
