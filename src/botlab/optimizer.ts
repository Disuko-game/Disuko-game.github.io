import { analyzeResults } from "./analytics";
import { buildSchedule, resolvePopulations } from "./scheduler";
import { simulateGame } from "./simulator";
import type { ExperimentSpec, GameResult, OptimizationResult, OptimizationSpec, ScheduledGame } from "./types";

export async function optimizeExperiment(
  spec: OptimizationSpec,
  progress?: (completed: number, total: number) => void,
  signal?: AbortSignal,
  executor?: (games: ScheduledGame[], experiment: ExperimentSpec, onResult: (result: GameResult) => Promise<void>) => Promise<void>
): Promise<OptimizationResult> {
  if (!Number.isInteger(spec.budget) || spec.budget <= 0) throw new Error("Optimization budget must be positive.");
  const populations = resolvePopulations(spec.experiment);
  const candidatePopulation = populations.find((population) => population.id === spec.candidatePopulationId);
  if (!candidatePopulation) throw new Error("Candidate population was not found.");
  let survivors = [...candidatePopulation.strategies];
  const requestedRounds = Math.max(1, spec.rounds ?? Math.ceil(Math.log2(Math.max(2, survivors.length))));
  const holdoutCount = Math.max(1, Math.floor(spec.budget * (spec.holdoutShare ?? 0.2)));
  const trainingBudget = Math.max(0, spec.budget - holdoutCount);
  const rounds = trainingBudget > 0 ? Math.min(requestedRounds, trainingBudget) : 0;
  const roundBudgets = distribute(trainingBudget, rounds);
  const allResults: GameResult[] = [];
  const roundRecords: OptimizationResult["rounds"] = [];
  let completed = 0;

  const execute = async (schedule: ScheduledGame[], experiment: ExperimentSpec, target: GameResult[]) => {
    const receive = async (result: GameResult) => {
      target.push(result);
      completed += 1;
      progress?.(completed, spec.budget);
    };
    if (executor) {
      await executor(schedule, experiment, receive);
      target.sort((left, right) => left.index - right.index);
      return;
    }
    for (const game of schedule) {
      if (signal?.aborted) break;
      await receive(simulateGame(game, experiment));
    }
  };

  for (let round = 0; round < rounds && survivors.length > 1; round += 1) {
    const games = roundBudgets[round];
    if (games <= 0) break;
    const candidatesAtStart = survivors.length;
    const experiment = {
      ...spec.experiment,
      id: spec.experiment.id + "-opt-" + round,
      games,
      seed: spec.experiment.seed + "-training-" + round,
      populations: spec.experiment.populations.map((population) =>
        population.id === spec.candidatePopulationId
          ? { ...population, source: { kind: "saved" as const, strategies: survivors } }
          : population
      )
    };
    const schedule = buildSchedule(experiment);
    const results: GameResult[] = [];
    await execute(schedule, experiment, results);
    allResults.push(...results);
    const rates = analyzeResults(experiment.id, results).strategyWinRates;
    survivors = survivors.sort((a, b) => (rates[b.id]?.rate ?? 0) - (rates[a.id]?.rate ?? 0))
      .slice(0, Math.max(1, Math.ceil(survivors.length / 2)));
    roundRecords.push({ round: round + 1, candidates: candidatesAtStart, games, survivors: survivors.map((strategy) => strategy.id) });
  }

  const holdoutSeeds: string[] = [];
  const holdoutSpec = {
    ...spec.experiment,
    id: spec.experiment.id + "-holdout",
    games: holdoutCount,
    seed: spec.experiment.seed + "-holdout",
    populations: spec.experiment.populations.map((population) =>
      population.id === spec.candidatePopulationId
        ? { ...population, source: { kind: "saved" as const, strategies: survivors } }
        : population
    )
  };
  const holdoutResults: GameResult[] = [];
  const holdoutSchedule = buildSchedule(holdoutSpec);
  holdoutSchedule.forEach((game) => holdoutSeeds.push(game.seed));
  await execute(holdoutSchedule, holdoutSpec, holdoutResults);
  const rates = analyzeResults(holdoutSpec.id, holdoutResults).strategyWinRates;
  const ranking = survivors.map((strategy) => ({
    strategy,
    games: rates[strategy.id]?.games ?? 0,
    wins: rates[strategy.id]?.wins ?? 0,
    winRate: rates[strategy.id]?.rate ?? 0,
    confidenceLow: rates[strategy.id]?.low ?? 0,
    confidenceHigh: rates[strategy.id]?.high ?? 1
  })).sort((a, b) => b.winRate - a.winRate || b.confidenceLow - a.confidenceLow);

  return { budget: spec.budget, gamesUsed: completed, rounds: roundRecords, ranking, holdoutSeeds };
}

function distribute(total: number, buckets: number): number[] {
  if (buckets <= 0) return [];
  const values = Array.from({ length: buckets }, () => 1);
  const remaining = total - buckets;
  if (remaining <= 0) return values;
  const weights = Array.from({ length: buckets }, (_, index) => 2 ** index);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const raw = weights.map((weight) => remaining * weight / weightTotal);
  raw.forEach((value, index) => { values[index] += Math.floor(value); });
  let left = total - values.reduce((sum, value) => sum + value, 0);
  raw.map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .forEach(({ index }) => { if (left > 0) { values[index] += 1; left -= 1; } });
  return values;
}