import {
  applyBotAction,
  chooseBotAction,
  expectedOpponentRerollValueControlGain,
  isOpeningValueControlState,
  isTacticalOpponentRerollAction,
  legalBotActions,
  valueControlStrength,
  type BotAction
} from "./bot";
import { currentPlayer, isOnBoard, offBoardDice, remainingDiceCount } from "./engine";
import { nextRandom, seedToState } from "./rng";
import { resolveBotStrategy, strategyHash, type BotStrategyConfig, type StrategyKnobPath } from "./botStrategy";
import { DICE_VALUES, type BotDifficulty, type DiceValue, type GameState } from "./types";

export interface BotCandidateTrace {
  action: BotAction;
  total: number;
  components: Record<string, number>;
}

export interface BotDecisionTrace {
  strategyId: string;
  strategyHash: string;
  policy: BotStrategyConfig["policy"];
  state: ReturnType<typeof stateFeatures>;
  legalActions: BotAction[];
  candidates: BotCandidateTrace[];
  chosenAction: BotAction;
  tieBreak: string;
}

export function chooseBotDecision(
  state: GameState,
  input: BotDifficulty | BotStrategyConfig,
  traceOptions: { enabled?: boolean } = {}
): { action: BotAction; trace?: BotDecisionTrace } {
  const strategy = resolveBotStrategy(input);
  if (strategy.baseline && strategy.policy === "preset") {
    const action = chooseBotAction(state, strategy.basePreset);
    return decisionResult(state, strategy, action, [], "unchanged-preset", traceOptions.enabled);
  }

  const legal = legalBotActions(state);
  if (legal.length === 0) {
    return decisionResult(state, strategy, { type: "pass" }, [], "no-legal-action", traceOptions.enabled);
  }
  const playerId = currentPlayer(state).id;
  const decisionActions = strategy.policy === "weighted-random" ? legal : legal.filter((action) => {
    const targetsOpponent = action.type === "reroll" && action.dieIds.some((dieId) =>
      state.dice.some((die) => die.id === dieId && die.ownerId !== playerId)
    );
    return !targetsOpponent || isTacticalOpponentRerollAction(state, action, playerId);
  });
  if (decisionActions.length === 0) {
    return decisionResult(state, strategy, { type: "pass" }, [], "no-strategic-action", traceOptions.enabled);
  }
  const challenges = decisionActions.filter((action) => action.type === "challenge");
  const candidates = challenges.length > 0 ? challenges : decisionActions.filter((action) => action.type !== "pass");

  if (strategy.policy === "weighted-random") {
    const action = chooseWeighted(state, candidates.length ? candidates : decisionActions, strategy);
    return decisionResult(state, strategy, action, [], "weighted-state-seeded", traceOptions.enabled);
  }

  const bounded = prefilterActions(state, candidates.length ? candidates : decisionActions, strategy.search.rootPrefilter, strategy);
  const scored = bounded.map((action) => scoreAction(state, action, strategy));
  if (strategy.policy === "search" && strategy.search.actionDepth > 1) {
    addSearchScores(state, scored, strategy);
  }
  const best = Math.max(...scored.map((candidate) => candidate.total));
  const tied = scored.filter((candidate) => Math.abs(candidate.total - best) < 0.000001)
    .sort((left, right) => actionKey(left.action).localeCompare(actionKey(right.action)));
  const action = pick(state, tied, "strategy-" + strategyHash(strategy)).action;
  return decisionResult(state, strategy, action, scored, "highest-score-state-seeded-tie", traceOptions.enabled);
}

function scoreAction(state: GameState, action: BotAction, strategy: BotStrategyConfig): BotCandidateTrace {
  if (action.type !== "reroll" || strategy.search.stochasticSamples <= 1) return scoreActionOnce(state, action, strategy);
  const samples = Array.from({ length: strategy.search.stochasticSamples }, (_, sample) => {
    const sampled = clone(state);
    sampled.rngState = seedToState(state.seed + "|" + state.turnNumber + "|" + strategyHash(strategy) + "|sample|" + sample);
    return scoreActionOnce(sampled, action, strategy);
  });
  const components: Record<string, number> = {};
  samples.forEach((sample) => Object.entries(sample.components).forEach(([key, value]) => { components[key] = (components[key] ?? 0) + value / samples.length; }));
  return { action, components, total: Object.values(components).reduce((sum, value) => sum + value, 0) };
}

function scoreActionOnce(state: GameState, action: BotAction, strategy: BotStrategyConfig): BotCandidateTrace {
  const playerId = currentPlayer(state).id;
  const beforeRemaining = remainingDiceCount(state, playerId);
  const next = applyBotAction(clone(state), action);
  const afterRemaining = remainingDiceCount(next, playerId);
  const completed = next.lastAction?.playerId === playerId ? next.lastAction.completedKeys.length : 0;
  const bankingGain = Math.max(0, next.actionCredits - Math.max(0, state.actionCredits - 1));
  const bankingRaw = bankingGain * strategy.weights.actionBankCredit
    - (action.type === "move" ? strategy.weights.actionBankMoveCost : 0);
  const targetsOpponent = action.type === "reroll" && action.dieIds.some((dieId) =>
    state.dice.some((die) => die.id === dieId && die.ownerId !== playerId)
  );
  const components: Record<string, number> = {
    progress: knob(strategy, "weights.placedDie") ? (beforeRemaining - afterRemaining) * strategy.weights.placedDie : 0,
    completion: knob(strategy, "weights.completion") ? completed * strategy.weights.completion : 0,
    retainedTurn: completed > 0 && next.phase === "playing" && currentPlayer(next).id === playerId
      ? (knob(strategy, "weights.retainedTurn") ? strategy.weights.retainedTurn : 0) : 0,
    actionType: action.type === "place" && knob(strategy, "weights.placementBias") ? strategy.weights.placementBias
      : action.type === "move" && completed === 0 && knob(strategy, "weights.unproductiveMove") ? strategy.weights.unproductiveMove
      : action.type === "reroll" && knob(strategy, "weights.reroll") ? strategy.weights.reroll
      : action.type === "pass" && knob(strategy, "weights.pass") ? strategy.weights.pass : 0,
    opponentReroll: targetsOpponent && knob(strategy, "weights.opponentReroll") ? strategy.weights.opponentReroll : 0,
    valueControl: action.type === "reroll"
      && isOpeningValueControlState(state)
      && strategy.components.valueControl
      && knob(strategy, "weights.valueControl")
      ? (valueControlStrength(next, playerId) - valueControlStrength(state, playerId)) * strategy.weights.valueControl
      : 0,
    position: evaluatePosition(next, playerId, strategy),
    actionBanking: strategy.components.actionBanking
      && knob(strategy, "weights.actionBankCredit")
      && bankingRaw >= strategy.weights.actionBankMinimumAdvantage ? bankingRaw : 0
  };
  return { action, components, total: Object.values(components).reduce((sum, value) => sum + value, 0) };
}

function evaluatePosition(state: GameState, rootPlayerId: string, strategy: BotStrategyConfig): number {
  if (state.phase === "won") return state.winnerId === rootPlayerId ? 1_000_000_000 : -1_000_000_000;
  let score = knob(strategy, "weights.remainingDie") ? -remainingDiceCount(state, rootPlayerId) * strategy.weights.remainingDie : 0;
  for (let index = 0; index < state.players.length; index += 1) {
    const player = state.players[index];
    const remaining = remainingDiceCount(state, player.id);
    const metrics = playerMetrics(state, index);
    if (player.id === rootPlayerId) {
      if (strategy.components.flexibility && knob(strategy, "weights.flexibility")) score += metrics.placements * strategy.weights.flexibility;
      if (strategy.components.completionOpportunity && knob(strategy, "weights.completionOpportunity")) score += metrics.completions * strategy.weights.completionOpportunity;
      if (remaining === 1 && metrics.wins > 0 && knob(strategy, "weights.ownImmediateWin")) score += strategy.weights.ownImmediateWin;
    } else {
      if (knob(strategy, "weights.opponentRemainingDie")) score += remaining * strategy.weights.opponentRemainingDie;
      if (strategy.components.flexibility && knob(strategy, "weights.opponentFlexibility")) score -= metrics.placements * strategy.weights.opponentFlexibility;
      if (strategy.components.completionOpportunity && knob(strategy, "weights.opponentOpportunity")) score -= metrics.completions * strategy.weights.opponentOpportunity;
      if (remaining === 1 && metrics.wins > 0 && knob(strategy, "weights.opponentImmediateWin")) score -= strategy.weights.opponentImmediateWin;
    }
  }
  if (currentPlayer(state).id === rootPlayerId && knob(strategy, "weights.actionCredit")) score += Math.max(0, state.actionCredits) * strategy.weights.actionCredit;
  if (strategy.components.valueReserve) score += valueReserveScore(state, rootPlayerId, strategy);

  if (strategy.components.threatAvoidance) score -= threatScore(state, rootPlayerId, strategy);
  return score;
}

function playerMetrics(state: GameState, playerIndex: number): { placements: number; completions: number; wins: number } {
  const perspective = clone(state);
  perspective.currentPlayerIndex = playerIndex;
  perspective.actionCredits = Math.max(1, perspective.actionCredits);
  const placements = legalBotActions(perspective).filter((action): action is Extract<BotAction, { type: "place" }> => action.type === "place");
  const completions = placements.filter((action) => completesUnit(perspective, action)).length;
  const wins = remainingDiceCount(perspective, perspective.players[playerIndex].id) === 1 ? placements.length : 0;
  return { placements: placements.length, completions, wins };
}

function completesUnit(state: GameState, action: Extract<BotAction, { type: "place" }>): boolean {
  const die = state.dice.find((candidate) => candidate.id === action.dieId);
  if (!die) return false;
  const board = state.dice.filter(isOnBoard);
  const rowCount = board.filter((candidate) => candidate.row === action.row).length;
  const colCount = board.filter((candidate) => candidate.col === action.col).length;
  const boxRow = Math.floor(action.row / 3);
  const boxCol = Math.floor(action.col / 2);
  const boxCount = board.filter((candidate) =>
    Math.floor((candidate.row as number) / 3) === boxRow && Math.floor((candidate.col as number) / 2) === boxCol
  ).length;
  const valueCount = board.filter((candidate) => candidate.value === die.value).length;
  return rowCount === 5 || colCount === 5 || boxCount === 5 || valueCount === 5;
}

function prefilterActions(
  state: GameState,
  actions: BotAction[],
  limit: number,
  strategy: BotStrategyConfig
): BotAction[] {
  if (actions.length <= limit) return actions;
  return [...actions].sort((left, right) => {
    const score = (action: BotAction) => {
      if (action.type === "challenge") return 1_000_000;
      if (action.type === "place") return 10_000 + (completesUnit(state, action) ? 5_000 : 0);
      if (action.type === "move") return 1_000;
      if (action.type === "reroll") {
        const playerId = currentPlayer(state).id;
        const target = action.dieIds.length === 1
          ? state.dice.find((die) => die.id === action.dieIds[0] && die.ownerId !== playerId)
          : undefined;
        const incentive = target && knob(strategy, "weights.opponentReroll")
          ? strategy.weights.opponentReroll
          : 0;
        const controlGain = target && strategy.components.valueControl && knob(strategy, "weights.valueControl")
          ? expectedOpponentRerollValueControlGain(state, action, playerId) * strategy.weights.valueControl
          : 0;
        return 100 + action.dieIds.length + incentive + controlGain;
      }
      return 0;
    };
    return score(right) - score(left) || actionKey(left).localeCompare(actionKey(right));
  }).slice(0, Math.max(1, limit));
}
function threatScore(state: GameState, rootPlayerId: string, strategy: BotStrategyConfig): number {
  const rootIndex = state.players.findIndex((player) => player.id === rootPlayerId);
  let score = 0;
  for (let offset = 1; offset < state.players.length; offset += 1) {
    const index = (rootIndex + offset) % state.players.length;
    const unitPath = offset === 1 ? "weights.nextOpponentThreat" as const : "weights.distantOpponentThreat" as const;
    const needsUnits = knob(strategy, unitPath);
    const needsWins = knob(strategy, "weights.threatenedOpponentWin");
    if (!needsUnits && !needsWins) continue;
    const metrics = playerMetrics(state, index);
    if (needsUnits) score += metrics.completions * (offset === 1 ? strategy.weights.nextOpponentThreat : strategy.weights.distantOpponentThreat);
    if (needsWins && metrics.wins > 0) score += strategy.weights.threatenedOpponentWin;
  }
  return score;
}

function valueReserveScore(state: GameState, playerId: string, strategy: BotStrategyConfig): number {
  const counts = new Map<DiceValue, number>();
  offBoardDice(state, playerId).forEach((die) => counts.set(die.value, (counts.get(die.value) ?? 0) + 1));
  return DICE_VALUES.reduce((score, value) => {
    const count = counts.get(value) ?? 0;
    if (!count) return score;
    let valueScore = knob(strategy, "weights.valuePresence") ? strategy.weights.valuePresence : 0;
    if (count === 1) {
      if (knob(strategy, "weights.lastValueReserve")) valueScore += strategy.weights.lastValueReserve;
      if (state.dice.filter((die) => isOnBoard(die) && die.value === value).length >= 4) {
        if (knob(strategy, "weights.nearValueSetReserve")) valueScore += strategy.weights.nearValueSetReserve;
      }
    }
    return score + valueScore;
  }, 0);
}

function addSearchScores(state: GameState, candidates: BotCandidateTrace[], strategy: BotStrategyConfig): void {
  const rootId = currentPlayer(state).id;
  const beam = [...candidates].sort((a, b) => b.total - a.total)
    .slice(0, strategy.search.rootPrefilter)
    .slice(0, strategy.search.rootBeam);
  const context = { nodes: 0, rootId };
  for (const candidate of beam) {
    if (context.nodes >= strategy.search.nodeBudget) break;
    const next = applyBotAction(clone(state), candidate.action);
    const handoffs = next.phase === "playing" && currentPlayer(next).id !== rootId ? 1 : 0;
    const continuation = searchValue(
      next,
      strategy,
      1,
      handoffs,
      candidate.action.type === "move" ? 1 : 0,
      context
    );
    candidate.components.search = continuation * 0.35;
    candidate.total += candidate.components.search;
  }
}

function searchValue(
  state: GameState,
  strategy: BotStrategyConfig,
  depth: number,
  handoffs: number,
  consecutiveMoves: number,
  context: { nodes: number; rootId: string }
): number {
  if (state.phase !== "playing"
    || depth >= strategy.search.actionDepth
    || handoffs > strategy.search.handoffDepth
    || context.nodes >= strategy.search.nodeBudget) {
    return evaluatePosition(state, context.rootId, strategy);
  }
  const maximizing = currentPlayer(state).id === context.rootId;
  const actions = prefilterActions(
    state,
    legalBotActions(state).filter((action) => action.type !== "pass"),
    strategy.search.nodePrefilter,
    strategy
  );
  const scored = actions.map((action) => scoreAction(state, action, strategy))
    .filter((candidate) => !strategy.components.actionBanking
      || candidate.action.type !== "move"
      || consecutiveMoves < strategy.search.actionBankMaxMoves)
    .sort((left, right) => maximizing ? right.total - left.total : left.total - right.total)
    .slice(0, strategy.search.nodeBeam);
  if (!scored.length) return evaluatePosition(state, context.rootId, strategy);
  let best = maximizing ? -Infinity : Infinity;
  for (const candidate of scored) {
    if (context.nodes >= strategy.search.nodeBudget) break;
    context.nodes += 1;
    const beforePlayer = currentPlayer(state).id;
    const next = applyBotAction(clone(state), candidate.action);
    const changedPlayer = next.phase === "playing" && currentPlayer(next).id !== beforePlayer;
    const child = candidate.total + 0.35 * searchValue(
      next,
      strategy,
      depth + 1,
      handoffs + (changedPlayer ? 1 : 0),
      candidate.action.type === "move" ? consecutiveMoves + 1 : 0,
      context
    );
    best = maximizing ? Math.max(best, child) : Math.min(best, child);
  }
  return Number.isFinite(best) ? best : evaluatePosition(state, context.rootId, strategy);
}
function chooseWeighted(state: GameState, actions: BotAction[], strategy: BotStrategyConfig): BotAction {
  const buckets = (["place", "move", "reroll"] as const).map((type) => ({
    type, actions: actions.filter((action) => action.type === type), weight: strategy.randomActionWeights[type]
  })).filter((bucket) => bucket.actions.length && bucket.weight > 0);
  const immediate = actions.filter((action) => action.type === "challenge" || action.type === "pass");
  if (immediate.length) return pick(state, immediate, strategy.id + "-immediate");
  if (!buckets.length) return pick(state, actions, strategy.id + "-fallback");
  const total = buckets.reduce((sum, bucket) => sum + bucket.weight, 0);
  const target = deterministicRandom(state, strategy.id + "-category") * total;
  let cursor = 0;
  for (const bucket of buckets) {
    cursor += bucket.weight;
    if (target < cursor) return pick(state, bucket.actions, strategy.id + "-" + bucket.type);
  }
  return pick(state, buckets[buckets.length - 1].actions, strategy.id + "-last");
}

function decisionResult(state: GameState, strategy: BotStrategyConfig, action: BotAction, candidates: BotCandidateTrace[], tieBreak: string, enabled?: boolean) {
  return {
    action,
    trace: enabled ? {
      strategyId: strategy.id,
      strategyHash: strategyHash(strategy),
      policy: strategy.policy,
      state: stateFeatures(state),
      legalActions: legalBotActions(state),
      candidates: [...candidates].sort((a, b) => b.total - a.total),
      chosenAction: action,
      tieBreak
    } satisfies BotDecisionTrace : undefined
  };
}

function stateFeatures(state: GameState) {
  const player = currentPlayer(state);
  return {
    turnNumber: state.turnNumber,
    playerId: player.id,
    actionCredits: state.actionCredits,
    boardOccupancy: state.dice.filter(isOnBoard).length,
    remainingDice: remainingDiceCount(state, player.id),
    trayValueDiversity: new Set(offBoardDice(state, player.id).map((die) => die.value)).size
  };
}

function deterministicRandom(state: GameState, salt: string): number {
  const dice = [...state.dice].sort((a, b) => a.id.localeCompare(b.id))
    .map((die) => [die.id, die.value, die.row ?? "t", die.col ?? "t"].join(":"))
    .join(",");
  return nextRandom(seedToState([state.seed, state.currentPlayerIndex, state.turnNumber, state.actionCredits, dice, salt].join("|"))).value;
}

function pick<T>(state: GameState, values: T[], salt: string): T {
  return values[Math.min(values.length - 1, Math.floor(deterministicRandom(state, salt) * values.length))];
}

function actionKey(action: BotAction): string {
  if (action.type === "place" || action.type === "move") return [action.type, action.dieId, action.row, action.col].join(":");
  if (action.type === "reroll") return "reroll:" + [...action.dieIds].sort().join(",");
  if (action.type === "challenge") return "challenge:" + action.targetDieId;
  return "pass";
}

function knob(strategy: BotStrategyConfig, path: StrategyKnobPath): boolean {
  return !strategy.disabledKnobs.includes(path);
}

function clone(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}
