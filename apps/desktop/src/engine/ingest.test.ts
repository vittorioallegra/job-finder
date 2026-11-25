// protects=an ingestion run goes through batched database calls, a company without a board fails as ai-unavailable when no AI is configured, refuses a second run while one is active, and sends its final event only after the run row is closed;
// fails_when=a second run starts while one is active, the final event is sent before runs.finish, a run never reads its companies, or a failed scan is not logged as a failed company;
// no_claim=the real board reads and the SQL behind the calls are not exercised here; the core run tests and the desktop database tests cover them.
import { describe, expect, it } from "vitest";
import type { HttpClient } from "@job-finder/core/net";
import { createIngestController } from "./ingest";
import type { DbCall, DbResult, EngineToMainMessage } from "./protocol";

const companies = [{ id: "co-1", name: "Acme", ats: "greenhouse", slug: "acme" }];

/** Every board read fails with a network error, so the run completes without writing postings. */
const networkDown: HttpClient = {
  resolve: (url) => url,
  isAllowed: async () => true,
  get: async (url) => ({ ok: false, code: "network", url }),
  post: async (url) => ({ ok: false, code: "network", url }),
};

const noRender = async () => ({ ok: false as const, code: "unknown" as const });

function fakeDb(list: unknown[] = companies) {
  const calls: string[] = [];
  const db = async (batch: DbCall[]): Promise<DbResult[]> =>
    batch.map((call) => {
      calls.push(call.name);
      const value =
        call.name === "companies.list"
          ? list
          : call.name === "ingest.lookup"
            ? { jobs: [], sources: [] }
            : null;
      return { ok: true, value };
    });
  return { db, calls };
}

async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 500 && !check(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  if (!check()) throw new Error("condition not met");
}

describe("ingestion controller", () => {
  it("runs a scan through database calls and sends the final event after the run row is closed", async () => {
    const { db, calls } = fakeDb();
    const sent: EngineToMainMessage[] = [];
    let finishedRowClosed = false;
    const controller = createIngestController({
      db,
      send: (message) => {
        sent.push(message);
        if (message.type === "ingest-progress" && message.event.kind === "run-finished") {
          finishedRowClosed = calls.includes("runs.finish");
        }
      },
      http: networkDown,
      renderPage: noRender,
      now: () => 5,
    });

    expect(controller.start("run-1")).toBe("accepted");
    await until(() =>
      sent.some((m) => m.type === "ingest-progress" && m.event.kind === "run-finished"),
    );

    const events = sent.flatMap((m) => (m.type === "ingest-progress" ? [m.event] : []));
    expect(events.map((event) => event.kind)).toEqual([
      "run-started",
      "company-started",
      "company-failed",
      "run-finished",
    ]);
    expect(events.at(-1)).toMatchObject({ kind: "run-finished", status: "succeeded" });
    expect(finishedRowClosed).toBe(true);
    expect(calls).toContain("companies.list");
    expect(calls.filter((name) => name === "run-events.append")).toHaveLength(4);
  });

  it("refuses a second run while one is active, and accepts one again after it finishes", async () => {
    const { db } = fakeDb();
    const sent: EngineToMainMessage[] = [];
    const controller = createIngestController({
      db,
      send: (message) => sent.push(message),
      http: networkDown,
      renderPage: noRender,
    });

    expect(controller.start("run-1")).toBe("accepted");
    expect(controller.start("run-2")).toBe("already-running");
    await until(() =>
      sent.some((m) => m.type === "ingest-progress" && m.event.kind === "run-finished"),
    );

    expect(controller.start("run-3")).toBe("accepted");
  });

  it("fails a company without a board as ai-unavailable when no AI is configured, and writes nothing", async () => {
    const generic = [
      {
        id: "co-2",
        name: "Generic",
        careersUrl: "https://generic.example.test/careers",
        ats: null,
        slug: null,
      },
    ];
    const { db, calls } = fakeDb(generic);
    const sent: EngineToMainMessage[] = [];
    const controller = createIngestController({
      db,
      send: (message) => sent.push(message),
      // The company's page answers but declares no postings, and no AI can read it.
      http: {
        ...networkDown,
        get: async (url) => ({
          ok: true as const,
          url,
          status: 200,
          contentType: "text/html",
          body: "<html></html>",
          cached: false,
        }),
      },
      renderPage: noRender,
      now: () => 5,
    });

    expect(controller.start("run-2")).toBe("accepted");
    await until(() =>
      sent.some((m) => m.type === "ingest-progress" && m.event.kind === "run-finished"),
    );

    const events = sent.flatMap((m) => (m.type === "ingest-progress" ? [m.event] : []));
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "company-failed",
        companyId: "co-2",
        code: "ai-unavailable",
      }),
    );
    expect(calls).not.toContain("ingest.persist");
    expect(calls).not.toContain("ingest.close-missing");
  });
});
