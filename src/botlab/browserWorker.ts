/// <reference lib="webworker" />
import { simulateGame, type SimulationLimits } from "./simulator";
import type { ScheduledGame } from "./types";

self.onmessage = (event: MessageEvent<{ type: "game"; game: ScheduledGame; limits: SimulationLimits }>) => {
  if (event.data.type !== "game") return;
  try {
    self.postMessage({ type: "result", result: simulateGame(event.data.game, event.data.limits) });
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
