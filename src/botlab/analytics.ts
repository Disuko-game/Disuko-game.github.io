import type { ExperimentSummary, GameMetrics, GameResult, RateEstimate } from "./types";

export function wilson(wins: number, games: number, z = 1.959963984540054): RateEstimate {
  if (!games) return { wins, games, rate: 0, low: 0, high: 1 };
  const rate = wins / games;
  const denominator = 1 + z * z / games;
  const center = (rate + z * z / (2 * games)) / denominator;
  const margin = z * Math.sqrt(rate * (1 - rate) / games + z * z / (4 * games * games)) / denominator;
  return { wins, games, rate, low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

export function analyzeResults(experimentId: string, results: GameResult[]): ExperimentSummary {
  const completed = results.filter((result) => result.terminationReason === "won" && result.winnerSeat !== undefined);
  const strategy = new Map<string, { wins: number; games: number }>();
  const population = new Map<string, { wins: number; games: number }>();
  const playerCount = new Map<string, Map<string, { wins: number; games: number }>>();
  const seats = new Map<string, { wins: number; games: number }>();
  const matchups = new Map<string, { wins: number; games: number }>();
  const starterStrategy = new Map<string, { wins: number; games: number }>();
  const situations = new Map<string, { wins: number; games: number }>();
  const terminationReasons: Record<string, number> = {};
  const actionTotals = emptyMetrics();
  let naturalStarterWins = 0;
  let naturalStarterGames = 0;
  let forcedStarterWins = 0;
  let forcedStarterGames = 0;
  let tieRounds = 0;
  let openingRounds = 0;

  for (const result of results) {
    terminationReasons[result.terminationReason] = (terminationReasons[result.terminationReason] ?? 0) + 1;
    mergeMetrics(actionTotals, result.metrics);
    tieRounds += result.openingTieRounds;
    openingRounds += result.openingRollRounds;
    if (result.winnerSeat === undefined) continue;
    if (result.starterMode === "natural") {
      naturalStarterGames += 1;
      if (result.winnerSeat === result.starterSeat) naturalStarterWins += 1;
    } else {
      forcedStarterGames += 1;
      if (result.winnerSeat === result.starterSeat) forcedStarterWins += 1;
    }
    increment(seats, String(result.winnerSeat), true);
    result.seats.forEach((seat) => {
      increment(strategy, seat.strategyId, seat.seat === result.winnerSeat);
      increment(starterStrategy, seat.strategyId + "|" + (seat.seat === result.starterSeat ? "starter" : "non-starter"), seat.seat === result.winnerSeat);
      increment(population, seat.populationId, seat.seat === result.winnerSeat);
      const countMap = nested(playerCount, String(result.playerCount));
      increment(countMap, seat.strategyId, seat.seat === result.winnerSeat);
    });
    result.actionLog?.forEach((record) => {
      if (!record.trace) return;
      const occupancy = record.trace.state.boardOccupancy;
      const phase = occupancy < 12 ? "early" : occupancy < 27 ? "middle" : "late";
      const remaining = record.trace.state.remainingDice <= 3 ? "endgame" : record.trace.state.remainingDice <= 8 ? "low-tray" : "full-tray";
      const key = result.playerCount + "p|" + phase + "|" + remaining + "|credits-" + Math.min(3, record.trace.state.actionCredits) + "|diversity-" + record.trace.state.trayValueDiversity + "|" + record.strategyId;
      increment(situations, key, record.strategyId === result.winnerStrategyId);
    });
    const winner = result.seats[result.winnerSeat];
    result.seats.filter((seat) => seat.seat !== result.winnerSeat).forEach((loser) => {
      increment(matchups, winner.strategyId + " > " + loser.strategyId, true);
      increment(matchups, loser.strategyId + " > " + winner.strategyId, false);
    });
  }

  const rates = mapRates(strategy);
  const strength = new Map(Object.entries(rates).map(([id, rate]) => [id, rate.rate]));
  let upsets = 0;
  let upsetGames = 0;
  completed.forEach((result) => {
    const winner = result.seats[result.winnerSeat as number];
    const winnerStrength = strength.get(winner.strategyId) ?? 0;
    const strongestOpponent = Math.max(...result.seats.filter((seat) => seat.seat !== winner.seat)
      .map((seat) => strength.get(seat.strategyId) ?? 0));
    if (Number.isFinite(strongestOpponent) && strongestOpponent !== winnerStrength) {
      upsetGames += 1;
      if (winnerStrength < strongestOpponent) upsets += 1;
    }
  });

  const strategyRates = [...strength.values()];
  const expectedNatural = naturalStarterGames ? average(completed.filter((result) => result.starterMode === "natural").map((result) => 1 / result.playerCount)) : 0;
  const expectedForced = forcedStarterGames ? average(completed.filter((result) => result.starterMode === "forced").map((result) => 1 / result.playerCount)) : 0;
  const forcedDifferences = completed.filter((result) => result.starterMode === "forced")
    .map((result) => (result.winnerSeat === result.starterSeat ? 1 : 0) - 1 / result.playerCount);

  return {
    experimentId,
    games: results.length,
    completedGames: completed.length,
    totalDurationMs: results.reduce((sum, result) => sum + result.durationMs, 0),
    gamesPerSecond: results.length * 1000 / Math.max(1, results.reduce((sum, result) => sum + result.durationMs, 0)),
    strategyWinRates: rates,
    populationWinRates: mapRates(population),
    playerCountWinRates: Object.fromEntries([...playerCount].map(([count, values]) => [count, mapRates(values)])),
    seatWinRates: mapRates(seats),
    starter: {
      naturalStarterWinRate: wilson(naturalStarterWins, naturalStarterGames),
      forcedStarterWinRate: wilson(forcedStarterWins, forcedStarterGames),
      openingTieRoundRate: openingRounds ? tieRounds / openingRounds : 0,
      byPlayerCount: Object.fromEntries([2, 3, 4].map((count) => {
        const subset = completed.filter((result) => result.playerCount === count);
        return [String(count), wilson(subset.filter((result) => result.winnerSeat === result.starterSeat).length, subset.length)];
      })),
      strategyInteraction: mapRates(starterStrategy)
    },
    matchups: mapRates(matchups),
    situationalWinRates: mapRates(situations),
    upsetRate: wilson(upsets, upsetGames),
    seedSensitivity: pairedSeedSensitivity(completed),
    luckSkill: {
      strategySpread: strategyRates.length ? Math.max(...strategyRates) - Math.min(...strategyRates) : 0,
      naturalStarterLift: naturalStarterGames ? naturalStarterWins / naturalStarterGames - expectedNatural : 0,
      forcedStarterLift: forcedStarterGames ? forcedStarterWins / forcedStarterGames - expectedForced : 0,
      forcedStarterBootstrap: pairedBootstrap(forcedDifferences, 17)
    },
    averageTurns: average(results.map((result) => result.turns)),
    averageActions: average(results.map((result) => result.actions)),
    terminationReasons,
    actionTotals,
    warnings: warnings(results)
  };
}

export function pairedBootstrap(
  differences: number[],
  seed = 1,
  samples = 2000
): { mean: number; low: number; high: number } {
  if (!differences.length) return { mean: 0, low: 0, high: 0 };
  let state = seed >>> 0;
  const estimates: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    let total = 0;
    for (let index = 0; index < differences.length; index += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      total += differences[state % differences.length];
    }
    estimates.push(total / differences.length);
  }
  estimates.sort((a, b) => a - b);
  return {
    mean: average(differences),
    low: estimates[Math.floor(samples * 0.025)],
    high: estimates[Math.min(samples - 1, Math.floor(samples * 0.975))]
  };
}

function pairedSeedSensitivity(results: GameResult[]): number {
  const groups = new Map<string, GameResult[]>();
  results.forEach((result) => {
    const group = groups.get(result.pairGroup) ?? [];
    group.push(result);
    groups.set(result.pairGroup, group);
  });
  const paired = [...groups.values()].filter((group) => group.length > 1);
  if (!paired.length) return 0;
  const changed = paired.filter((group) => new Set(group.map((result) => result.winnerStrategyId)).size > 1).length;
  return changed / paired.length;
}

function increment(map: Map<string, { wins: number; games: number }>, key: string, won: boolean): void {
  const value = map.get(key) ?? { wins: 0, games: 0 };
  value.games += 1;
  if (won) value.wins += 1;
  map.set(key, value);
}
function nested(map: Map<string, Map<string, { wins: number; games: number }>>, key: string) {
  const value = map.get(key) ?? new Map();
  map.set(key, value);
  return value;
}
function mapRates(map: Map<string, { wins: number; games: number }>): Record<string, RateEstimate> {
  return Object.fromEntries([...map].map(([key, value]) => [key, wilson(value.wins, value.games)]));
}
function average(values: number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function warnings(results: GameResult[]): string[] {
  const warnings: string[] = [];
  const capped = results.filter((result) => result.terminationReason !== "won").length;
  if (capped) warnings.push(capped + " games did not reach a winner.");
  if (results.length < 100) warnings.push("Small sample: treat win-rate differences as exploratory.");
  return warnings;
}
function emptyMetrics(): GameMetrics {
  return { placements: 0, moves: 0, rerolls: 0, challenges: 0, passes: 0, actionCreditsEarned: 0, completionKinds: { row: 0, column: 0, box: 0, value: 0 } };
}
function mergeMetrics(target: GameMetrics, source: GameMetrics): void {
  target.placements += source.placements; target.moves += source.moves; target.rerolls += source.rerolls;
  target.challenges += source.challenges; target.passes += source.passes; target.actionCreditsEarned += source.actionCreditsEarned;
  (["row", "column", "box", "value"] as const).forEach((kind) => { target.completionKinds[kind] += source.completionKinds[kind]; });
}
