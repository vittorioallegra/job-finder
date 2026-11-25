import {
  isLocalAiEndpoint,
  listAiModels,
  testAiConnection,
  type AiProviderConfig,
} from "@job-finder/core/ai";
import { discoverCompanies } from "@job-finder/core/discovery";
import { createHttpClient } from "@job-finder/core/net";
import { createIngestController } from "./ingest";
import { generateDocument } from "@job-finder/core/documents/generate";
import { mapFormFields } from "@job-finder/core/ats/autofill/ai";
import { checkLatestRelease, RELEASES_REPOSITORY } from "@job-finder/core/updates";
import { createScoringRunner } from "./scoring";
import { fromElectronPort } from "./port";
import { createEngineRuntime } from "./runtime";

/** A connection test waits at most this long for the provider before it reports a failure. */
const AI_TEST_TIMEOUT_MS = 20_000;

/** Extraction and one AI call on a long CV can take a while; the renderer shows a loading state meanwhile. */
const CV_IMPORT_TIMEOUT_MS = 120_000;

/** A tailored document is one or two AI calls on a long profile; the renderer shows a loading state meanwhile. */
const DOCUMENT_TIMEOUT_MS = 180_000;

/** Mapping a form is one AI call on the form's fields and the profile; the apply window waits meanwhile. */
const AUTOFILL_AI_TIMEOUT_MS = 120_000;

/**
 * A model on this computer answers far slower than a hosted one, and its first answer includes
 * loading it into memory, so every AI deadline stretches to at least this long for it.
 */
const LOCAL_AI_TIMEOUT_MS = 600_000;

/** A connection test to a model on this computer waits for it to load. */
const LOCAL_AI_TEST_TIMEOUT_MS = 120_000;

/** The deadline for one AI task: the hosted one, or the longer one for a model on this computer. */
function aiDeadline(config: AiProviderConfig, hostedMs: number, localMs = LOCAL_AI_TIMEOUT_MS) {
  return AbortSignal.timeout(isLocalAiEndpoint(config) ? Math.max(hostedMs, localMs) : hostedMs);
}

/** The update check is one request; a slow GitHub answer is treated as no answer. */
const UPDATE_CHECK_TIMEOUT_MS = 15_000;
/** A model list is one small request; a short wait keeps the settings screen responsive. */
const MODEL_LIST_TIMEOUT_MS = 8_000;

/** A discovery run makes one request per query, one second apart; it returns what it found by the deadline. */
const DISCOVERY_TIMEOUT_MS = 120_000;
/** A wide scan reads about a thousand boards. */
const WIDE_SCAN_TIMEOUT_MS = 900_000;

// Utility process entry. Main sends the engine end of a MessageChannel as the first message.
// The bundler keeps shared helpers in this entry, so main may load this file without being the
// utility process; only a utility process has a parent port, so only it starts the runtime.
const parentPort = process.parentPort;
if (parentPort) {
  parentPort.once("message", (event) => {
    const [port] = event.ports;
    if (port) {
      // Main sets the override only when it is allowed (not packaged, or under E2E) and points at loopback.
      const fixtureBaseUrl = process.env["JOB_FINDER_FIXTURE_BASE_URL"];
      const net = createHttpClient({
        fixtureBaseUrl,
        // Public job APIs that many boards read: a few requests a second, not one.
        hostIntervalMs: {
          "boards-api.greenhouse.io": 200,
          "api.lever.co": 200,
          "api.ashbyhq.com": 200,
        },
      });
      createEngineRuntime(fromElectronPort(port), {
        net,
        createIngest: (api) => createIngestController({ ...api, http: net }),
        createScoring: (db) => createScoringRunner(db),
        testAiConnection: (config) =>
          testAiConnection(config, {
            abortSignal: aiDeadline(config, AI_TEST_TIMEOUT_MS, LOCAL_AI_TEST_TIMEOUT_MS),
          }),
        discoverCompanies: (criteria, config) =>
          discoverCompanies(criteria, {
            http: net,
            config,
            signal: AbortSignal.timeout(
              criteria.wide || criteria.postings ? WIDE_SCAN_TIMEOUT_MS : DISCOVERY_TIMEOUT_MS,
            ),
          }),
        generateDocument: (request) =>
          generateDocument(
            {
              kind: request.kind,
              profile: request.profile,
              job: request.job,
              language: request.language,
              config: request.ai.config,
              contextSize: request.ai.contextSize,
            },
            { abortSignal: aiDeadline(request.ai.config, DOCUMENT_TIMEOUT_MS) },
          ),
        mapFormFields: (request) =>
          mapFormFields(
            {
              fields: request.fields,
              profile: request.profile,
              language: request.language,
              config: request.ai.config,
              contextSize: request.ai.contextSize,
            },
            { abortSignal: aiDeadline(request.ai.config, AUTOFILL_AI_TIMEOUT_MS) },
          ),
        checkForUpdate: (currentVersion) => {
          // Without a configured repository there is nothing to ask, so no request is made.
          if (RELEASES_REPOSITORY === null) {
            return Promise.resolve({ ok: true, release: null });
          }
          return checkLatestRelease({
            http: net,
            repository: RELEASES_REPOSITORY,
            currentVersion,
            signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
          });
        },
        listModels: (request) =>
          listAiModels(request, { signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS) }),
        importCv: async (request, signal) => {
          // Loaded on first use: the CV readers pull in PDF and DOCX parsers the app does not need until a CV is imported.
          const { importCv } = await import("@job-finder/core/cv");
          return importCv(request, {
            abortSignal: AbortSignal.any([
              aiDeadline(request.config, CV_IMPORT_TIMEOUT_MS),
              signal,
            ]),
          });
        },
      });
    }
  });
}
