import { parentPort, workerData } from "node:worker_threads";
import { simulateGame } from "../src/botlab/simulator";
import type { SimulationLimits } from "../src/botlab/simulator";
import type { ScheduledGame } from "../src/botlab/types";

const data = workerData as { limits: SimulationLimits };

parentPort?.on("message", (message: { type: "game"; game: ScheduledGame } | { type: "stop" }) => {
  if (message.type === "stop") {
    parentPort?.close();
    return;
  }
  try {
    parentPort?.postMessage({ type: "result", result: simulateGame(message.game, data.limits) });
  } catch (error) {
    parentPort?.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
});
parentPort?.postMessage({ type: "ready" });
