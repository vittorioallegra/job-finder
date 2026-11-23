import { testAiConnection } from "@job-finder/core/ai";
import { fromElectronPort } from "./port";
import { createEngineRuntime } from "./runtime";

/** A connection test waits at most this long for the provider before it reports a failure. */
const AI_TEST_TIMEOUT_MS = 20_000;

/** Extraction and one AI call on a long CV can take a while; the renderer shows a loading state meanwhile. */
const CV_IMPORT_TIMEOUT_MS = 120_000;

// Utility process entry. Main sends the engine end of a MessageChannel as the first message.
// The bundler keeps shared helpers in this entry, so main may load this file without being the
// utility process; only a utility process has a parent port, so only it starts the runtime.
const parentPort = process.parentPort;
if (parentPort) {
  parentPort.once("message", (event) => {
    const [port] = event.ports;
    if (port) {
      createEngineRuntime(fromElectronPort(port), {
        testAiConnection: (config) =>
          testAiConnection(config, { abortSignal: AbortSignal.timeout(AI_TEST_TIMEOUT_MS) }),
        importCv: async (request) => {
          // Loaded on first use: the CV readers pull in PDF and DOCX parsers the app does not need until a CV is imported.
          const { importCv } = await import("@job-finder/core/cv");
          return importCv(request, { abortSignal: AbortSignal.timeout(CV_IMPORT_TIMEOUT_MS) });
        },
      });
    }
  });
}
