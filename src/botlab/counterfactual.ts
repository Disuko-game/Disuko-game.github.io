import { applyBotAction, type BotAction } from "../game/bot";
import { chooseBotDecision } from "../game/botDecision";
import { currentPlayer } from "../game/engine";
import { seedToState } from "../game/rng";
import { resolveBotStrategy, strategyHash, type BotStrategyConfig } from "../game/botStrategy";
import type { BotDifficulty, GameState } from "../game/types";

export interface CounterfactualResult {
  strategyId: string;
  strategyHash: string;
  chosenAction: BotAction;
  continuations: number;
  wins: number;
  winRate: number;
  averageActions: number;
}

/**
 * Compares policies from an identical state. Each policy receives the same
 * future RNG for a continuation seed; the production rules engine applies all
 * actions. Continuations use the tested strategy for every seat, isolating the
 * policy's state handling rather than a particular opponent mix.
 */
export function analyzeCounterfactual(
  state: GameState,
  inputs: Array<BotDifficulty | BotStrategyConfig>,
  continuationSeeds: string[],
  maxActions = 5000
): CounterfactualResult[] {
  return inputs.map((input) => {
    const strategy = resolveBotStrategy(input);
    const chosenAction = chooseBotDecision(state, strategy).action;
    let wins = 0;
    let actionTotal = 0;
    for (const continuationSeed of continuationSeeds) {
      let next = clone(state);
      next.rngState = seedToState(continuationSeed);
      const rootPlayerId = currentPlayer(next).id;
      let actions = 0;
      while (next.phase === "playing" && actions < maxActions) {
        const decision = chooseBotDecision(next, strategy);
        next = applyBotAction(next, decision.action);
        actions += 1;
      }
      actionTotal += actions;
      if (next.winnerId === rootPlayerId) wins += 1;
    }
    return {
      strategyId: strategy.id,
      strategyHash: strategyHash(strategy),
      chosenAction,
      continuations: continuationSeeds.length,
      wins,
      winRate: continuationSeeds.length ? wins / continuationSeeds.length : 0,
      averageActions: continuationSeeds.length ? actionTotal / continuationSeeds.length : 0
    };
  });
}

function clone(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}
