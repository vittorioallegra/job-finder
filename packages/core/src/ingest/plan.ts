import { fingerprint, identityKey, type NormalizedJob } from "../normalize";

/** A job row already stored, with the sources that report it. */
export interface StoredJob {
  id: string;
  fingerprint: string;
  sources: string[];
}

/** A source row already stored: which job a posting of one source belongs to. */
export interface StoredSource {
  source: string;
  sourceJobId: string;
  jobId: string;
}

/** What the store already holds for the jobs of one batch. */
export interface ExistingState {
  jobs: StoredJob[];
  sources: StoredSource[];
}

/** What to read before planning a batch: the fingerprints and source identities it mentions. */
export interface LookupRequest {
  fingerprints: string[];
  sources: { source: string; sourceJobId: string }[];
}

export interface JobInsert {
  id: string;
  companyId: string;
  fingerprint: string;
  job: NormalizedJob;
}

export interface SourceWrite {
  source: string;
  sourceJobId: string;
  jobId: string;
  companyId: string;
  url: string;
  applyUrl: string;
  runId: string;
}

/** Writes for one batch. `touches` are existing jobs seen again (their last seen time moves, a closed job reopens). */
export interface BatchPlan {
  seenAt: number;
  inserts: JobInsert[];
  touches: string[];
  sources: SourceWrite[];
}

export function lookupRequest(jobs: readonly NormalizedJob[]): LookupRequest {
  return {
    fingerprints: [...new Set(jobs.map((job) => fingerprint(job)))],
    sources: jobs.map((job) => ({ source: job.source, sourceJobId: job.sourceJobId })),
  };
}

export interface PlanBatchInput {
  companyId: string;
  runId: string;
  seenAt: number;
  jobs: readonly NormalizedJob[];
  existing: ExistingState;
  newId: () => string;
}

/**
 * Plans the writes for one batch of postings from one company board.
 *
 * Identity is (source, source job id): a known pair updates its job. A new pair joins an
 * existing job with the same fingerprint only when that job has no posting from the same source,
 * so cross-source duplicates are stored once while two openings of one source stay apart.
 * Postings repeated inside the batch count once.
 */
export function planBatch(input: PlanBatchInput): BatchPlan {
  const jobIdByKey = new Map<string, string>();
  for (const source of input.existing.sources) {
    jobIdByKey.set(identityKey(source), source.jobId);
  }

  const jobsByFingerprint = new Map<string, StoredJob[]>();
  const addCandidate = (job: StoredJob) => {
    const list = jobsByFingerprint.get(job.fingerprint);
    if (list) list.push(job);
    else jobsByFingerprint.set(job.fingerprint, [job]);
  };
  for (const job of input.existing.jobs) {
    addCandidate({ ...job, sources: [...job.sources] });
  }

  const inserts: JobInsert[] = [];
  const insertedIds = new Set<string>();
  const touched = new Set<string>();
  const sources: SourceWrite[] = [];
  const seenKeys = new Set<string>();

  for (const job of input.jobs) {
    const key = identityKey(job);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    let jobId = jobIdByKey.get(key);
    if (jobId === undefined) {
      const postingFingerprint = fingerprint(job);
      const match = (jobsByFingerprint.get(postingFingerprint) ?? []).find(
        (candidate) => !candidate.sources.includes(job.source),
      );
      if (match) {
        jobId = match.id;
        match.sources.push(job.source);
      } else {
        jobId = input.newId();
        inserts.push({
          id: jobId,
          companyId: input.companyId,
          fingerprint: postingFingerprint,
          job,
        });
        insertedIds.add(jobId);
        addCandidate({ id: jobId, fingerprint: postingFingerprint, sources: [job.source] });
      }
      jobIdByKey.set(key, jobId);
    }

    if (!insertedIds.has(jobId)) touched.add(jobId);
    sources.push({
      source: job.source,
      sourceJobId: job.sourceJobId,
      jobId,
      companyId: input.companyId,
      url: job.url,
      applyUrl: job.applyUrl,
      runId: input.runId,
    });
  }

  return { seenAt: input.seenAt, inserts, touches: [...touched], sources };
}
