import { getAdapter } from "../ats";
import type { AdapterResult, AtsAdapter, AtsId } from "../ats";
import type { HttpClient } from "../net";
import type { NormalizedJob } from "../normalize";
import { identityKey } from "../normalize";
import {
  lookupRequest,
  planBatch,
  type BatchPlan,
  type ExistingState,
  type LookupRequest,
} from "./plan";
import type { IngestEvent, IngestRunOutcome } from "./events";

/** A company whose careers board is scanned. Null `ats` or `slug`: no supported board, so its careers page is read instead. */
export interface IngestCompany {
  id: string;
  name: string;
  careersUrl: string;
  ats: AtsId | null;
  slug: string | null;
}

/** What a generic careers page scan needs to know about its company. */
export interface CareersScanTarget {
  name: string;
  careersUrl: string;
}

/**
 * What the run needs from storage. The engine implements it with batched database calls through
 * main; tests implement it in memory. Writes are separate calls so a failed batch is reported as such.
 */
export interface IngestStore {
  listCompanies(): Promise<IngestCompany[]>;
  beginRun(runId: string, startedAt: number): Promise<void>;
  appendEvent(event: IngestEvent): Promise<void>;
  finishRun(runId: string, outcome: IngestRunOutcome, finishedAt: number): Promise<void>;
  lookup(request: LookupRequest): Promise<ExistingState>;
  persist(plan: BatchPlan): Promise<void>;
  /**
   * Closes the postings of one company that its complete scan did not see, and returns how many.
   * Called only after every batch of a complete, successful scan has been persisted.
   */
  closeMissing(companyId: string, runId: string, at: number): Promise<number>;
}

export interface RunIngestionOptions {
  runId: string;
  store: IngestStore;
  http: HttpClient;
  /** Aborting it stops the run: no further company is scanned and nothing is closed after the abort. */
  signal: AbortSignal;
  now?: () => number;
  newId?: () => string;
  adapterFor?: (ats: AtsId) => AtsAdapter;
  /**
   * Reads a company's generic careers page. Omitted: companies without a supported board fail with
   * `no-board`, as before. The scan follows the same rules as a board read: a failure returns no jobs.
   */
  scanCareers?: (target: CareersScanTarget) => Promise<AdapterResult>;
  /** Postings written per batch. */
  batchSize?: number;
  /** Scans only this company (a retry from the Companies screen). Unset: every company. */
  companyId?: string;
}

const DEFAULT_BATCH_SIZE = 50;

type EventBody = DistributiveOmit<IngestEvent, "runId" | "seq" | "at">;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type CompanyResult =
  | { kind: "scanned"; jobCount: number; closedCount: number }
  | { kind: "failed"; code: string }
  | { kind: "cancelled" };

/**
 * Scans every company board in turn and persists what it reads.
 *
 * A company is only closed after its complete, successful scan. A failed read (adapter failure,
 * storage error, abort) returns no jobs for that company and closes nothing, and the run moves
 * on to the next company, so one broken board never stops the others.
 */
export async function runIngestion(options: RunIngestionOptions): Promise<IngestRunOutcome> {
  const { runId, store, http, signal } = options;
  const now = options.now ?? (() => Date.now());
  const newId = options.newId ?? (() => crypto.randomUUID());
  const adapterFor = options.adapterFor ?? getAdapter;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  let seq = 0;

  const record = async (body: EventBody): Promise<void> => {
    const event = { ...body, runId, seq, at: now() } as IngestEvent;
    seq += 1;
    await store.appendEvent(event);
  };

  async function scanCompany(company: IngestCompany): Promise<CompanyResult> {
    let result: AdapterResult;
    try {
      if (company.ats === null || company.slug === null) {
        if (!options.scanCareers) return { kind: "failed", code: "no-board" };
        result = await options.scanCareers({ name: company.name, careersUrl: company.careersUrl });
      } else {
        result = await adapterFor(company.ats).fetchJobs(
          { ats: company.ats, slug: company.slug, companyName: company.name },
          http,
          { signal },
        );
      }
    } catch {
      return signal.aborted ? { kind: "cancelled" } : { kind: "failed", code: "unknown" };
    }
    if (!result.ok) {
      return signal.aborted || result.code === "aborted"
        ? { kind: "cancelled" }
        : { kind: "failed", code: result.code };
    }

    const jobs = uniqueByIdentity(result.jobs);
    try {
      for (const batch of chunk(jobs, batchSize)) {
        if (signal.aborted) return { kind: "cancelled" };
        const existing = await store.lookup(lookupRequest(batch));
        const plan = planBatch({
          companyId: company.id,
          runId,
          seenAt: now(),
          jobs: batch,
          existing,
          newId,
        });
        await store.persist(plan);
      }
      if (signal.aborted) return { kind: "cancelled" };
      const closedCount = await store.closeMissing(company.id, runId, now());
      return { kind: "scanned", jobCount: jobs.length, closedCount };
    } catch {
      return signal.aborted ? { kind: "cancelled" } : { kind: "failed", code: "storage-failed" };
    }
  }

  await store.beginRun(runId, now());
  let outcome: IngestRunOutcome;
  try {
    await record({ kind: "run-started" });
    const companies = (await store.listCompanies()).filter(
      (company) => options.companyId === undefined || company.id === options.companyId,
    );
    outcome = "succeeded";
    for (const company of companies) {
      if (signal.aborted) {
        outcome = "cancelled";
        break;
      }
      const companyName = company.name;
      await record({ kind: "company-started", companyId: company.id, companyName });
      const result = await scanCompany(company);
      if (result.kind === "scanned") {
        await record({
          kind: "company-scanned",
          companyId: company.id,
          companyName,
          jobCount: result.jobCount,
          closedCount: result.closedCount,
        });
      } else if (result.kind === "failed") {
        await record({
          kind: "company-failed",
          companyId: company.id,
          companyName,
          code: result.code,
        });
      } else {
        outcome = "cancelled";
        break;
      }
    }
    if (signal.aborted) outcome = "cancelled";
  } catch {
    outcome = "failed";
  }

  await record({ kind: "run-finished", status: outcome });
  await store.finishRun(runId, outcome, now());
  return outcome;
}

/** Keeps the first posting of each (source, source job id); a source repeats an id only by mistake. */
function uniqueByIdentity(jobs: readonly NormalizedJob[]): NormalizedJob[] {
  const seen = new Set<string>();
  return jobs.filter((job) => {
    const key = identityKey(job);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
