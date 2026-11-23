import { testAiConnection } from "@job-finder/core/ai";
import { importCv } from "@job-finder/core/cv";
import { fromElectronPort } from "./port";
import { createEngineRuntime } from "./runtime";

/** A connection test waits at most this long for the provider before it reports a failure. */
const AI_TEST_TIMEOUT_MS = 20_000;

/** Extraction and one AI call on a long CV can take a while; the renderer shows a loading state meanwhile. */
const CV_IMPORT_TIMEOUT_MS = 120_000;

// Utility process entry. Main sends the engine end of a MessageChannel as the first message.
process.parentPort.once("message", (event) => {
  const [port] = event.ports;
  if (port) {
    createEngineRuntime(fromElectronPort(port), {
      testAiConnection: (config) =>
        testAiConnection(config, { abortSignal: AbortSignal.timeout(AI_TEST_TIMEOUT_MS) }),
      importCv: (request) =>
        importCv(request, { abortSignal: AbortSignal.timeout(CV_IMPORT_TIMEOUT_MS) }),
    });
  }
});
