import { fromElectronPort } from "./port";
import { createEngineRuntime } from "./runtime";

// Utility process entry. Main sends the engine end of a MessageChannel as the first message.
process.parentPort.once("message", (event) => {
  const [port] = event.ports;
  if (port) {
    createEngineRuntime(fromElectronPort(port));
  }
});
