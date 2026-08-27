import { applyBotAction, type BotAction } from "../game/bot";
import { chooseBotDecision } from "../game/botDecision";
import { calculateCompletionKeys, completeOpeningRoll, currentPlayer, isOnBoard, newGame, remainingDiceCount } from "../game/engine";
import { strategyHash } from "../game/botStrategy";
import type { CompletionKind, GameState } from "../game/types";
import { analyzeResults } from "./analytics";
import { buildSchedule, resolvePopulations } from "./scheduler";
import type {
  ActionRecord, ExperimentProgress, ExperimentRun, ExperimentSpec, GameMetrics, GameResult, ScheduledGame
} from "./types";

export type SimulationLimits = Pick<ExperimentSpec,
  "maxTurns" | "maxActionsPerTurn" | "maxTotalActions" | "maxRepeatedStates" | "maxTraceActions" | "maxRuntimeMs" | "opponentRerollEnabled"
>;

export function simulateGame(game: ScheduledGame, limits: SimulationLimits = {}): GameResult {
  const started = performance.now();
  let state = newGame({
    playerCount: game.playerCount,
    seed: game.seed,
    opponentRerollEnabled: limits.opponentRerollEnabled ?? false,
    playerNames: game.seats.map((seat) => seat.strategy.label),
    playerControllers: game.seats.map((seat) => ({ kind: "bot", difficulty: seat.strategy.basePreset }))
  });
  const naturalStarterSeat = state.currentPlayerIndex;
  if (game.starter !== "natural") state = { ...state, currentPlayerIndex: game.starter };
  state = completeOpeningRoll(state);
  const starterSeat = state.currentPlayerIndex;
  const openingRollRounds = state.openingRoll?.rounds.length ?? 0;
  const openingTieRounds = Math.max(0, openingRollRounds - 1);
  const actionLog: ActionRecord[] | undefined = game.trace ? [] : undefined;
  const metrics = emptyMetrics();
  const maxTurns = limits.maxTurns ?? 1000;
  const maxActionsPerTurn = limits.maxActionsPerTurn ?? 64;
  const maxTotalActions = limits.maxTotalActions ?? 2000;
  const maxRepeatedStates = limits.maxRepeatedStates ?? 3;
  const maxTraceActions = limits.maxTraceActions ?? 250;
  const maxRuntimeMs = limits.maxRuntimeMs ?? Number.POSITIVE_INFINITY;
  let terminationReason: GameResult["terminationReason"] = "won";
  let totalActions = 0;
  let stalled = false;
  let traceTruncated = false;
  const stateOccurrences = new Map<string, number>();
  stateOccurrences.set(repetitionSignature(state), 1);

  while (state.phase === "playing") {
    if (state.turnNumber > maxTurns) { terminationReason = "turn-cap"; break; }
    if (performance.now() - started > maxRuntimeMs) { terminationReason = "runtime-cap"; break; }
    const turnPlayerId = currentPlayer(state).id;
    let actionsThisTurn = 0;
    while (state.phase === "playing" && currentPlayer(state).id === turnPlayerId) {
      if (actionsThisTurn >= maxActionsPerTurn) {
        terminationReason = "action-cap";
        state = applyBotAction(state, { type: "pass" });
        break;
      }
      if (totalActions >= maxTotalActions) {
        terminationReason = "total-action-cap";
        break;
      }
      const seat = state.currentPlayerIndex;
      const scheduledSeat = game.seats[seat];
      const captureTrace = Boolean(actionLog && actionLog.length < maxTraceActions);
      const decision = chooseBotDecision(state, scheduledSeat.strategy, { enabled: captureTrace });
      const before = state;
      const beforeCompletions = new Map(calculateCompletionKeys(before).map((completion) => [completion.key, completion.kind]));
      state = applyBotAction(state, decision.action);
      const completedKinds = (state.lastAction?.completedKeys ?? []).map((key) =>
        calculateCompletionKeys(state).find((completion) => completion.key === key)?.kind
          ?? beforeCompletions.get(key)
      ).filter((kind): kind is CompletionKind => Boolean(kind));
      recordMetric(metrics, decision.action, completedKinds, before.actionCredits, state.actionCredits);
      if (captureTrace) {
        actionLog!.push({
          actionIndex: totalActions,
          turnNumber: before.turnNumber,
          playerId: turnPlayerId,
          seat,
          strategyId: scheduledSeat.strategy.id,
          action: decision.action,
          completedKinds,
          actionCreditsBefore: before.actionCredits,
          actionCreditsAfter: state.actionCredits,
          remainingDiceAfter: remainingDiceCount(state, turnPlayerId),
          boardOccupancy: state.dice.filter(isOnBoard).length,
          trace: decision.trace
        });
      } else if (game.trace) {
        traceTruncated = true;
      }
      totalActions += 1;
      actionsThisTurn += 1;
      if (stateSignature(before) === stateSignature(state)) {
        state = applyBotAction(state, { type: "pass" });
        stalled = true;
        break;
      }
      const signature = repetitionSignature(state);
      const occurrences = (stateOccurrences.get(signature) ?? 0) + 1;
      stateOccurrences.set(signature, occurrences);
      if (occurrences >= maxRepeatedStates) {
        terminationReason = "repeated-state";
        break;
      }
    }
    if (terminationReason === "action-cap" || terminationReason === "total-action-cap" || terminationReason === "repeated-state") break;
  }
  if (stalled && state.phase !== "won" && terminationReason === "won") terminationReason = "stalled";

  const winnerSeat = state.winnerId ? state.players.findIndex((player) => player.id === state.winnerId) : undefined;
  const durationMs = performance.now() - started;
  return {
    index: game.index,
    pairGroup: game.pairGroup,
    seed: game.seed,
    playerCount: game.playerCount,
    starterMode: game.starter === "natural" ? "natural" : "forced",
    starterSeat,
    naturalStarterSeat,
    openingRollRounds,
    openingTieRounds,
    seats: game.seats.map((seat) => ({
      seat: seat.seat,
      playerId: state.players[seat.seat].id,
      populationId: seat.populationId,
      strategyId: seat.strategy.id,
      strategyHash: strategyHash(seat.strategy),
      remainingDice: remainingDiceCount(state, state.players[seat.seat].id)
    })),
    winnerSeat: winnerSeat !== undefined && winnerSeat >= 0 ? winnerSeat : undefined,
    winnerStrategyId: winnerSeat !== undefined && winnerSeat >= 0 ? game.seats[winnerSeat].strategy.id : undefined,
    turns: state.turnNumber,
    actions: totalActions,
    metrics,
    durationMs,
    terminationReason: state.phase === "won" ? "won" : terminationReason,
    actionLog: game.trace ? actionLog : undefined,
    traceTruncated: game.trace ? traceTruncated : undefined,
    finalState: game.trace ? state : undefined
  };
}

export async function runExperiment(
  spec: ExperimentSpec,
  progressCallback?: (progress: ExperimentProgress) => void,
  options: { signal?: AbortSignal; existingResults?: GameResult[] } = {}
): Promise<ExperimentRun> {
  const populations = resolvePopulations(spec);
  const schedule = buildSchedule(spec, populations);
  const byIndex = new Map((options.existingResults ?? []).map((result) => [result.index, result]));
  const started = performance.now();
  for (const game of schedule) {
    if (options.signal?.aborted) break;
    if (!byIndex.has(game.index)) byIndex.set(game.index, simulateGame(game, spec));
    const completed = byIndex.size;
    const elapsed = Math.max(1, performance.now() - started);
    progressCallback?.({
      completed,
      total: schedule.length,
      gamesPerSecond: completed * 1000 / elapsed,
      etaMs: completed ? (schedule.length - completed) * elapsed / completed : undefined,
      latest: byIndex.get(game.index)
    });
    if (game.index % 10 === 0) await Promise.resolve();
  }
  const results = [...byIndex.values()].sort((a, b) => a.index - b.index);
  return { spec, populations, schedule, results, summary: analyzeResults(spec.id, results) };
}

function emptyMetrics(): GameMetrics {
  return {
    placements: 0, moves: 0, rerolls: 0, challenges: 0, passes: 0, actionCreditsEarned: 0,
    completionKinds: { row: 0, column: 0, box: 0, value: 0 }
  };
}

function recordMetric(metrics: GameMetrics, action: BotAction, completions: CompletionKind[], beforeCredits: number, afterCredits: number): void {
  if (action.type === "place") metrics.placements += 1;
  if (action.type === "move") metrics.moves += 1;
  if (action.type === "reroll") metrics.rerolls += 1;
  if (action.type === "challenge") metrics.challenges += 1;
  if (action.type === "pass") metrics.passes += 1;
  metrics.actionCreditsEarned += Math.max(0, afterCredits - Math.max(0, beforeCredits - 1));
  completions.forEach((kind) => { metrics.completionKinds[kind] += 1; });
}

function stateSignature(state: GameState): string {
  return JSON.stringify([
    state.phase, state.currentPlayerIndex, state.turnNumber, state.actionCredits, state.rngState,
    state.dice.map((die) => [die.id, die.value, die.row, die.col]), state.winnerId
  ]);
}

function repetitionSignature(state: GameState): string {
  return JSON.stringify([
    state.phase,
    state.currentPlayerIndex,
    state.dice.map((die) => [die.id, die.value, die.row, die.col]),
    state.winnerId
  ]);
}
