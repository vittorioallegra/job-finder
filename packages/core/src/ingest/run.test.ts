// protects=a company is closed only after every batch of its complete, successful scan is stored, a failed, cancelled or storage-broken scan closes nothing while the other companies still run, and the run log records each step in order and ends with the outcome;
// fails_when=a posting is closed after a failed or partial scan, one broken board stops the run, a board without an ATS is requested, a cancelled run keeps scanning, a repeated posting is written twice, or the log is out of order or misses the outcome;
// no_claim=the HTTP requests, the ATS payloads and the SQL behind the store are not exercised here; the adapter tests and the desktop database tests cover them.
import { describe, expect, it } from "vitest";
import type { AtsAdapter, AtsId, BoardRef } from "../ats";
import type { HttpClient } from "../net";
import type { NormalizedJob } from "../normalize";
import type { IngestEvent } from "./events";
import type { BatchPlan } from "./plan";
import { runIngestion, type IngestCompany, type IngestStore } from "./run";

const http: HttpClient = {
  resolve: (url) => url,
  isAllowed: async () => true,
  get: async (url) => ({ ok: false, code: "network", url }),
};

function job(sourceJobId: string, overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    source: "greenhouse",
    sourceJobId,
    url: `https://example.test/${sourceJobId}`,
    applyUrl: `https://example.test/${sourceJobId}/apply`,
    companyName: "Acme",
    title: `Role ${sourceJobId}`,
    description: "",
    locations: [{ raw: "Remote" }],
    workMode: "unknown",
    employmentType: "unknown",
    seniority: "unknown",
    visaSponsorship: "unknown",
    ...overrides,
  };
}

type Script = { ok: true; jobs: NormalizedJob[] } | { ok: false; code: string } | "throw";

interface Trace {
  log: string[];
  events: IngestEvent[];
  persisted: BatchPlan[];
  closed: string[];
  finished: string[];
  requested: string[];
}

interface RunOptions {
  batchSize?: number;
  controller?: AbortController;
  closeResult?: number;
  /** Called for each batch, with the company the batch belongs to. */
  onPersist?: (plan: BatchPlan, companyId: string) => void;
}

/** Runs the orchestration against an in-memory store and scripted boards. */
async function run(
  companies: IngestCompany[],
  scripts: Record<string, Script>,
  options: RunOptions = {},
): Promise<{ outcome: string; trace: Trace }> {
  const controller = options.controller ?? new AbortController();
  const trace: Trace = {
    log: [],
    events: [],
    persisted: [],
    closed: [],
    finished: [],
    requested: [],
  };
  const store: IngestStore = {
    listCompanies: async () => companies,
    beginRun: async () => {
      trace.log.push("begin");
    },
    appendEvent: async (event) => {
      trace.events.push(event);
    },
    finishRun: async (_runId, outcome) => {
      trace.log.push(`finish:${outcome}`);
      trace.finished.push(outcome);
    },
    lookup: async () => ({ jobs: [], sources: [] }),
    persist: async (plan) => {
      const companyId = plan.sources[0]?.companyId ?? plan.inserts[0]?.companyId ?? "";
      trace.log.push(`persist:${companyId}`);
      trace.persisted.push(plan);
      options.onPersist?.(plan, companyId);
    },
    closeMissing: async (companyId) => {
      trace.log.push(`close:${companyId}`);
      trace.closed.push(companyId);
      return options.closeResult ?? 0;
    },
  };
  const adapter: AtsAdapter = {
    id: "greenhouse",
    fetchJobs: async (board: BoardRef) => {
      trace.requested.push(board.slug);
      const script = scripts[board.slug];
      if (script === "throw" || script === undefined) {
        throw new Error("adapter crashed");
      }
      if (!script.ok) {
        return { ok: false, code: script.code as "http-status", url: board.slug };
      }
      return { ok: true, jobs: script.jobs };
    },
  };
  let counter = 0;
  const outcome = await runIngestion({
    runId: "run-1",
    store,
    http,
    signal: controller.signal,
    now: () => 1_000 + counter,
    newId: () => `id-${++counter}`,
    adapterFor: () => adapter,
    batchSize: options.batchSize ?? 50,
  });
  return { outcome, trace };
}

function company(id: string, slug: string, ats: AtsId | null = "greenhouse"): IngestCompany {
  return { id, name: `Company ${slug}`, ats, slug: ats === null ? null : slug };
}

describe("runIngestion", () => {
  it("stores every batch of a complete scan and closes the company only after the last batch", async () => {
    const jobs = [job("1"), job("2"), job("3"), job("4"), job("5")];
    const { outcome, trace } = await run(
      [company("co-a", "acme")],
      { acme: { ok: true, jobs } },
      { batchSize: 2 },
    );

    expect(outcome).toBe("succeeded");
    expect(trace.persisted.map((plan) => plan.inserts.length)).toEqual([2, 2, 1]);
    expect(
      trace.log.filter((entry) => entry.startsWith("persist") || entry.startsWith("close")),
    ).toEqual(["persist:co-a", "persist:co-a", "persist:co-a", "close:co-a"]);
  });

  it("closes nothing and keeps scanning when one board fails, reporting the failure code", async () => {
    const { outcome, trace } = await run([company("co-a", "broken"), company("co-b", "fine")], {
      broken: { ok: false, code: "http-status" },
      fine: { ok: true, jobs: [job("1")] },
    });

    expect(outcome).toBe("succeeded");
    expect(trace.closed).toEqual(["co-b"]);
    expect(trace.persisted).toHaveLength(1);
    expect(trace.events).toContainEqual(
      expect.objectContaining({ kind: "company-failed", companyId: "co-a", code: "http-status" }),
    );
  });

  it("treats an adapter that throws as a failed company and carries on", async () => {
    const { outcome, trace } = await run([company("co-a", "crash"), company("co-b", "fine")], {
      crash: "throw",
      fine: { ok: true, jobs: [job("1")] },
    });

    expect(outcome).toBe("succeeded");
    expect(trace.events).toContainEqual(
      expect.objectContaining({ kind: "company-failed", companyId: "co-a", code: "unknown" }),
    );
    expect(trace.closed).toEqual(["co-b"]);
  });

  it("closes nothing and reports a storage failure when a batch cannot be written", async () => {
    const { outcome, trace } = await run(
      [company("co-a", "acme"), company("co-b", "other")],
      {
        acme: { ok: true, jobs: [job("1"), job("2")] },
        other: { ok: true, jobs: [job("3")] },
      },
      {
        batchSize: 1,
        onPersist: (_plan, companyId) => {
          if (companyId === "co-a") throw new Error("disk full");
        },
      },
    );

    expect(outcome).toBe("succeeded");
    expect(trace.closed).toEqual(["co-b"]);
    expect(trace.events).toContainEqual(
      expect.objectContaining({
        kind: "company-failed",
        companyId: "co-a",
        code: "storage-failed",
      }),
    );
  });

  it("stops without closing anything when the run is cancelled during a scan", async () => {
    const controller = new AbortController();
    const { outcome, trace } = await run(
      [company("co-a", "acme"), company("co-b", "other")],
      {
        acme: { ok: true, jobs: [job("1"), job("2")] },
        other: { ok: true, jobs: [job("3")] },
      },
      { batchSize: 1, controller, onPersist: () => controller.abort() },
    );

    expect(outcome).toBe("cancelled");
    expect(trace.closed).toEqual([]);
    expect(trace.requested).toEqual(["acme"]);
    expect(trace.finished).toEqual(["cancelled"]);
  });

  it("starts no company when the run is cancelled before it begins", async () => {
    const controller = new AbortController();
    controller.abort();
    const { outcome, trace } = await run(
      [company("co-a", "acme")],
      { acme: { ok: true, jobs: [job("1")] } },
      { controller },
    );

    expect(outcome).toBe("cancelled");
    expect(trace.requested).toEqual([]);
  });

  it("never asks a board for a company without an ATS, and records the reason", async () => {
    const { trace } = await run([company("co-a", "none", null)], {});

    expect(trace.requested).toEqual([]);
    expect(trace.events).toContainEqual(
      expect.objectContaining({ kind: "company-failed", companyId: "co-a", code: "no-board" }),
    );
  });

  it("closes every posting of a company whose complete scan finds none", async () => {
    const { outcome, trace } = await run(
      [company("co-a", "empty")],
      { empty: { ok: true, jobs: [] } },
      { closeResult: 3 },
    );

    expect(outcome).toBe("succeeded");
    expect(trace.persisted).toEqual([]);
    expect(trace.closed).toEqual(["co-a"]);
    expect(trace.events).toContainEqual(
      expect.objectContaining({ kind: "company-scanned", jobCount: 0, closedCount: 3 }),
    );
  });

  it("writes a posting repeated inside one scan once", async () => {
    const { trace } = await run([company("co-a", "acme")], {
      acme: { ok: true, jobs: [job("1"), job("1", { title: "Other title" })] },
    });

    expect(trace.persisted[0]?.inserts).toHaveLength(1);
    expect(trace.persisted[0]?.sources).toHaveLength(1);
  });

  it("records the run log in order, numbered from zero, and ends with the outcome", async () => {
    const { trace } = await run([company("co-a", "broken"), company("co-b", "fine")], {
      broken: { ok: false, code: "timeout" },
      fine: { ok: true, jobs: [job("1")] },
    });

    expect(trace.events.map((event) => event.seq)).toEqual(trace.events.map((_, i) => i));
    expect(trace.events.map((event) => event.kind)).toEqual([
      "run-started",
      "company-started",
      "company-failed",
      "company-started",
      "company-scanned",
      "run-finished",
    ]);
    expect(trace.events.at(-1)).toMatchObject({ kind: "run-finished", status: "succeeded" });
    expect(trace.finished).toEqual(["succeeded"]);
  });
});
