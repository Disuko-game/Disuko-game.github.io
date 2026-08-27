import { describe, expect, it } from "vitest";
import { chooseBotAction } from "./bot";
import { chooseBotDecision } from "./botDecision";
import { newGame } from "./engine";
import {
  BOT_STRATEGY_PRESETS, STRATEGY_KNOBS, customizeStrategy, generateStrategyCandidates, resolveBotStrategy, strategyHash
} from "./botStrategy";
import type { BotDifficulty } from "./types";

describe("bot strategy configurations", () => {
  it("preserves every shipped preset decision exactly", () => {
    const difficulties: BotDifficulty[] = ["very-easy", "easy", "medium", "hard"];
    for (const seed of ["baseline-a", "baseline-b", "baseline-c"]) {
      const state = newGame({ playerCount: 2, seed, skipOpeningRoll: true });
      difficulties.forEach((difficulty) => {
        expect(chooseBotDecision(state, difficulty).action).toEqual(chooseBotAction(state, difficulty));
        expect(chooseBotDecision(state, BOT_STRATEGY_PRESETS[difficulty]).action).toEqual(chooseBotAction(state, difficulty));
      });
    }
  });

  it("keeps presets immutable and returns independent resolved copies", () => {
    expect(Object.isFrozen(BOT_STRATEGY_PRESETS.hard)).toBe(true);
    const first = resolveBotStrategy("hard");
    first.weights.completion = 1;
    expect(resolveBotStrategy("hard").weights.completion).not.toBe(1);
  });

  it("generates a finite deterministic candidate pool and implements every knob mode", () => {
    const template = {
      idPrefix: "test", labelPrefix: "Test", basePreset: "hard" as const, policy: "search" as const,
      knobs: {
        "weights.completion": { mode: "random" as const, min: 1000, max: 2000 },
        "weights.lastValueReserve": { mode: "fixed" as const, value: 0 },
        "weights.distantOpponentThreat": { mode: "disabled" as const },
        "weights.placedDie": { mode: "existing" as const }
      }
    };
    const first = generateStrategyCandidates(template, 5, "pool-seed");
    const repeated = generateStrategyCandidates(template, 5, "pool-seed");
    expect(repeated).toEqual(first);
    expect(new Set(first.map((strategy) => strategy.id)).size).toBeGreaterThan(1);
    first.forEach((strategy) => {
      expect(strategy.weights.lastValueReserve).toBe(0);
      expect(strategy.disabledKnobs).not.toContain("weights.lastValueReserve");
      expect(strategy.weights.distantOpponentThreat).toBe(0);
      expect(strategy.disabledKnobs).toContain("weights.distantOpponentThreat");
      expect(strategy.weights.placedDie).toBe(BOT_STRATEGY_PRESETS.hard.weights.placedDie);
    });
  });

  it("registers every numeric strategy knob centrally", () => {
    const expected = [
      ...Object.keys(BOT_STRATEGY_PRESETS.hard.weights).map((key) => "weights." + key),
      ...Object.keys(BOT_STRATEGY_PRESETS.hard.search).map((key) => "search." + key),
      ...Object.keys(BOT_STRATEGY_PRESETS.hard.randomActionWeights).map((key) => "randomActionWeights." + key)
    ];
    expect(new Set(STRATEGY_KNOBS.map((knob) => knob.path))).toEqual(new Set(expected));
  });

  it("hashes fixed-zero and disabled configurations differently", () => {
    const fixed = customizeStrategy("medium", { id: "fixed", label: "Fixed", weights: { lastValueReserve: 0 } });
    const disabled = customizeStrategy("medium", { id: "disabled", label: "Disabled", weights: { lastValueReserve: 0 }, disabledKnobs: ["weights.lastValueReserve"] });
    expect(strategyHash(fixed)).not.toBe(strategyHash(disabled));
  });

  it("keeps a tactical opponent reroll in the custom Hard shortlist", () => {
    const game = newGame({
      skipOpeningRoll: true,
      playerCount: 2,
      seed: "strategy-value-control",
      opponentRerollEnabled: true
    });
    const ownFives = game.dice.filter((die) => die.ownerId === "p1").slice(0, 4);
    const opponentFive = game.dice.find((die) => die.ownerId === "p2")!;
    ownFives.forEach((die) => { die.value = 5; });
    opponentFive.value = 5;
    game.dice = [...ownFives, opponentFive];
    const strategy = customizeStrategy("hard", { id: "control", label: "Control" });
    const result = chooseBotDecision(game, strategy, { enabled: true });

    expect(result.trace?.candidates).toContainEqual(expect.objectContaining({
      action: { type: "reroll", dieIds: [opponentFive.id] }
    }));
    expect(result.action).toEqual({ type: "reroll", dieIds: [opponentFive.id] });
  });
});
