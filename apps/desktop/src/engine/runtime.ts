import type { AiConnectionResult, AiProviderConfig } from "@job-finder/core/ai";
import type { CvImportOutcome, CvImportRequest } from "@job-finder/core/cv";
import type {
  DiscoveryCriteria,
  DiscoveryOutcome,
  SearchSourceConfig,
} from "@job-finder/core/discovery/types";
import { guardPageRender, type HttpClient, type PageRenderResult } from "@job-finder/core/net";
import type { DbCall, DbResult, EngineToMainMessage, MainToEngineMessage } from "./protocol";
import type { PortLike } from "./port";
import type { IngestController } from "./ingest";

export interface EngineRuntime {
  /** Sends one batch of database calls to main and resolves with one result per call, in order. */
  db(calls: DbCall[]): Promise<DbResult[]>;
  /**
   * Renders a JavaScript page through main's hidden loader. The URL is resolved and checked
   * against robots.txt first; a refused URL never reaches main.
   */
  renderPage(url: string): Promise<PageRenderResult>;
  close(): void;
}

/** What the ingestion controller is given: database work, reports to main, and page rendering through main. */
export interface IngestApi {
  db(calls: DbCall[]): Promise<DbResult[]>;
  send(message: EngineToMainMessage): void;
  /** Same as `EngineRuntime.renderPage`: robots.txt is checked before main renders anything. */
  renderPage(url: string): Promise<PageRenderResult>;
}

/** Work the engine does for main that needs the network or the AI layer. */
export interface EngineServices {
  testAiConnection(config: AiProviderConfig): Promise<AiConnectionResult>;
  importCv(request: CvImportRequest): Promise<CvImportOutcome>;
  /** Searches for ATS boards through the engine's HTTP path. */
  discoverCompanies(
    criteria: DiscoveryCriteria,
    config: SearchSourceConfig,
  ): Promise<DiscoveryOutcome>;
  /** The engine's HTTP path: fixture override, robots.txt and the per-host queue. */
  net: HttpClient;
  /** Builds the ingestion controller over the runtime's database and message channel. */
  createIngest(api: IngestApi): IngestController;
}

/**
 * Engine side of the message port: answers pings, runs AI work and ingestion, and issues batched
 * database requests. Pure over `PortLike`, so it runs in a utility process and in tests alike.
 */
export function createEngineRuntime(port: PortLike, services: EngineServices): EngineRuntime {
  let nextId = 1;
  const pending = new Map<number, (results: DbResult[]) => void>();
  const pendingPages = new Map<number, (result: PageRenderResult) => void>();

  const db = (calls: DbCall[]): Promise<DbResult[]> =>
    new Promise((resolve) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, resolve);
      post(port, { type: "db", id, calls });
    });

  const sendPageRender = (url: string): Promise<PageRenderResult> =>
    new Promise((resolve) => {
      const id = nextId;
      nextId += 1;
      pendingPages.set(id, resolve);
      post(port, { type: "page-render", id, url });
    });
  const renderGuarded = guardPageRender(services.net, sendPageRender);

  const ingest = services.createIngest({
    db,
    send: (message) => post(port, message),
    renderPage: renderGuarded,
  });

  port.on("message", (data) => {
    const message = data as MainToEngineMessage;
    if (message.type === "ping") {
      post(port, { type: "pong", id: message.id });
      return;
    }
    if (message.type === "ai-test") {
      const { id, config } = message;
      void services
        .testAiConnection(config)
        .catch((): AiConnectionResult => ({ ok: false, code: "unknown" }))
        .then((result) => post(port, { type: "ai-test-result", id, result }));
      return;
    }
    if (message.type === "cv-import") {
      const { id, request } = message;
      void services
        .importCv(request)
        .catch((): CvImportOutcome => ({ ok: false, code: "unknown" }))
        .then((outcome) => post(port, { type: "cv-import-result", id, outcome }));
      return;
    }
    if (message.type === "ingest-start") {
      const { id, runId, companyId, ai } = message;
      post(port, { type: "ingest-start-result", id, code: ingest.start(runId, companyId, ai) });
      return;
    }
    if (message.type === "discover-companies") {
      const { id, criteria, config } = message;
      void services
        .discoverCompanies(criteria, config)
        .catch((): DiscoveryOutcome => ({ ok: false, code: "search-failed" }))
        .then((outcome) => post(port, { type: "discover-companies-result", id, outcome }));
      return;
    }
    if (message.type === "ingest-cancel") {
      ingest.cancel(message.runId);
      return;
    }
    if (message.type === "db-result") {
      pending.get(message.id)?.(message.results);
      pending.delete(message.id);
      return;
    }
    if (message.type === "page-render-result") {
      pendingPages.get(message.id)?.(message.result);
      pendingPages.delete(message.id);
    }
  });
  port.start();

  return {
    db,
    renderPage: renderGuarded,
    close() {
      port.close();
    },
  };
}

function post(port: PortLike, message: EngineToMainMessage): void {
  port.postMessage(message);
}
