import { MessageChannelMain, utilityProcess } from "electron";
import { fromElectronPort } from "../../engine/port";
import type { EngineHandle } from "./supervisor";

/** Starts the engine as an Electron utility process and hands it the engine end of a port. */
export function createUtilityProcessLauncher(
  enginePath: string,
  env: NodeJS.ProcessEnv,
): () => EngineHandle {
  return () => {
    const child = utilityProcess.fork(enginePath, [], { serviceName: "job-finder-engine", env });
    const { port1, port2 } = new MessageChannelMain();
    child.postMessage({ type: "port" }, [port2]);
    return {
      port: fromElectronPort(port1),
      onExit: (listener) => {
        child.on("exit", listener);
      },
      stop: () => {
        child.kill();
      },
    };
  };
}
