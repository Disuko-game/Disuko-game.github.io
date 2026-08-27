import {
  canRerollOpponentDie,
  challengeViolation,
  currentPlayer,
  detectConflicts,
  endAction,
  getDieAt,
  isOnBoard,
  moveDie,
  offBoardDice,
  placeDie,
  remainingDiceCount,
  rerollDice,
  wasDieMovedThisTurn,
  wouldMoveDieConflict,
  wouldPlaceDieConflict
} from "./engine";
import { boxIndex } from "./geometry";
import { nextRandom, seedToState } from "./rng";
import {
  BOARD_SIZE,
  DICE_VALUES,
  type BotDifficulty,
  type DiceValue,
  type Die,
  type GameState,
  type Player
} from "./types";

export type BotAction =
  | { type: "place"; dieId: string; row: number; col: number }
  | { type: "move"; dieId: string; row: number; col: number }
  | { type: "reroll"; dieIds: string[] }
  | { type: "challenge"; targetDieId: string }
  | { type: "pass" };

export interface RunBotTurnOptions {
  difficulty?: BotDifficulty;
  maxActions?: number;
}

const EASY_ACTION_WEIGHTS: Record<"place" | "move" | "reroll", number> = {
  place: 0.7,
  move: 0.15,
  reroll: 0.15
};

const MEDIUM_STOCHASTIC_SAMPLES = 6;
const HARD_STOCHASTIC_SAMPLES = 8;
const HARD_ROOT_PREFILTER = 18;
const HARD_NODE_PREFILTER = 8;
const HARD_ROOT_BEAM = 5;
const HARD_NODE_BEAM = 2;
const HARD_HANDOFF_DEPTH = 1;
const HARD_ACTION_DEPTH = 4;
const HARD_NODE_BUDGET = 12;
const HARD_ACTION_BANK_MAX_MOVES = 5;
const HARD_ACTION_BANK_CREDIT_VALUE = 16_000;
const HARD_ACTION_BANK_MOVE_COST = 500;
const HARD_ACTION_BANK_MIN_ADVANTAGE = 1_000;
const HARD_VALUE_CONTROL_WEIGHT = 3_000;
const OPENING_VALUE_CONTROL_MAX_BOARD_DICE = 6;
const DEFAULT_MAX_TURN_ACTIONS = 64;
const WIN_SCORE = 1_000_000_000;

/**
 * Returns the concrete, valid actions the bot is willing to consider.
 *
 * Placement and movement candidates are exhaustive. Rerolls are deliberately
 * bounded to single dice, value groups, and the full tray so an 18-die tray
 * does not produce 2^18 subsets. Pass is returned only when no productive
 * action is available.
 */
export function legalBotActions(state: GameState): BotAction[] {
  if (state.phase !== "playing") {
    return [];
  }

  if (state.actionCredits <= 0) {
    return [{ type: "pass" }];
  }

  const actions: BotAction[] = [];
  const player = currentPlayer(state);
  const emptyCells = boardCells().filter(({ row, col }) => !getDieAt(state, row, col));
  const challengeDieIds = new Set(detectConflicts(state).flatMap((conflict) => conflict.dieIds));

  [...challengeDieIds]
    .sort((left, right) => left.localeCompare(right))
    .forEach((targetDieId) => actions.push({ type: "challenge", targetDieId }));

  const trayDice = offBoardDice(state, player.id);

  trayDice.forEach((die) => {
    emptyCells.forEach(({ row, col }) => {
      if (!wouldPlaceDieConflict(state, die.id, row, col)) {
        actions.push({ type: "place", dieId: die.id, row, col });
      }
    });
  });

  state.dice.filter(isOnBoard).forEach((die) => {
    if (wasDieMovedThisTurn(state, die.id)) {
      return;
    }

    emptyCells.forEach(({ row, col }) => {
      if (!wouldMoveDieConflict(state, die.id, row, col)) {
        actions.push({ type: "move", dieId: die.id, row, col });
      }
    });
  });

  rerollCandidateIds(trayDice).forEach((dieIds) => actions.push({ type: "reroll", dieIds }));
  if (state.opponentRerollEnabled) {
    state.dice
      .filter((die) => die.ownerId !== player.id && canRerollOpponentDie(state, die.id))
      .sort((left, right) => left.id.localeCompare(right.id))
      .forEach((die) => actions.push({ type: "reroll", dieIds: [die.id] }));
  }


  return actions.length > 0 ? actions : [{ type: "pass" }];
}

/** Applies a bot action through the public rules engine without mutating the input state. */
export function applyBotAction(state: GameState, action: BotAction): GameState {
  switch (action.type) {
    case "place":
      return placeDie(state, action.dieId, action.row, action.col);
    case "move":
      return moveDie(state, action.dieId, action.row, action.col);
    case "reroll":
      return rerollDice(state, action.dieIds, { defaultToAll: false });
    case "challenge":
      return challengeViolation(state, action.targetDieId);
    case "pass":
      return endAction(state);
  }
}

/** Chooses one deterministic action at the requested difficulty. */
export function chooseBotAction(state: GameState, difficulty: BotDifficulty): BotAction {
  const actions = legalBotActions(state);

  if (actions.length === 0) {
    return { type: "pass" };
  }

  const challengeActions = actions.filter((action): action is Extract<BotAction, { type: "challenge" }> => {
    return action.type === "challenge";
  });

  if (challengeActions.length > 0) {
    return chooseChallenge(state, difficulty, challengeActions);
  }

  const productiveActions = actions.filter((action) => action.type !== "pass");

  if (productiveActions.length === 0) {
    return { type: "pass" };
  }

  if (difficulty === "very-easy") {
    return chooseVeryEasyAction(state, productiveActions);
  }

  const strategic = strategicActions(state, productiveActions);

  if (difficulty === "easy") {
    return chooseHighestScoringAction(
      state,
      strategic,
      (action) => classicMediumActionScore(state, action, currentPlayer(state).id),
      "easy-choice"
    );
  }

  if (difficulty === "medium") {
    return chooseHighestScoringAction(
      state,
      strategic,
      (action) => mediumActionScore(state, action, currentPlayer(state).id),
      "medium-choice"
    );
  }

  return chooseHardAction(state, strategic);
}

/**
 * Runs every action earned by the active bot, including combo actions, until
 * play reaches another player or the game is won. A forced pass at the guard
 * keeps malformed or cyclic states from trapping the UI in a bot turn.
 */
export function runBotTurn(
  state: GameState,
  options: RunBotTurnOptions = {}
): { state: GameState; actions: BotAction[] } {
  if (state.phase !== "playing") {
    return { state, actions: [] };
  }

  const startingPlayerId = currentPlayer(state).id;
  const difficulty = options.difficulty ?? difficultyForPlayer(currentPlayer(state)) ?? "medium";
  const maxActions = Math.max(1, Math.floor(options.maxActions ?? DEFAULT_MAX_TURN_ACTIONS));
  const actions: BotAction[] = [];
  let nextState = state;

  for (let actionIndex = 0; actionIndex < maxActions; actionIndex += 1) {
    if (nextState.phase !== "playing" || currentPlayer(nextState).id !== startingPlayerId) {
      break;
    }

    const action = chooseBotAction(nextState, difficulty);
    const beforeKey = progressKey(nextState);
    const afterAction = applyBotAction(nextState, action);

    actions.push(action);
    nextState = afterAction;

    if (progressKey(afterAction) === beforeKey) {
      const passAction: BotAction = { type: "pass" };
      nextState = applyBotAction(afterAction, passAction);
      actions.push(passAction);
      break;
    }
  }

  if (nextState.phase === "playing" && currentPlayer(nextState).id === startingPlayerId) {
    const passAction: BotAction = { type: "pass" };
    nextState = applyBotAction(nextState, passAction);
    actions.push(passAction);
  }

  return { state: nextState, actions };
}

function chooseVeryEasyAction(state: GameState, actions: BotAction[]): BotAction {
  const buckets = (["place", "move", "reroll"] as const)
    .map((type) => ({
      type,
      actions: actions.filter((action) => action.type === type),
      weight: EASY_ACTION_WEIGHTS[type]
    }))
    .filter((bucket) => bucket.actions.length > 0);

  if (buckets.length === 0) {
    return pickDeterministically(state, actions, "easy-fallback");
  }

  const totalWeight = buckets.reduce((total, bucket) => total + bucket.weight, 0);
  const target = deterministicRandom(state, "easy-category") * totalWeight;
  let cursor = 0;
  let selectedBucket = buckets[buckets.length - 1];

  for (const bucket of buckets) {
    cursor += bucket.weight;

    if (target < cursor) {
      selectedBucket = bucket;
      break;
    }
  }

  return pickDeterministically(state, selectedBucket.actions, `easy-${selectedBucket.type}`);
}

function chooseChallenge(
  state: GameState,
  difficulty: BotDifficulty,
  actions: Array<Extract<BotAction, { type: "challenge" }>>
): BotAction {
  if (difficulty === "very-easy") {
    return pickDeterministically(state, actions, "easy-challenge");
  }

  const rootPlayerId = currentPlayer(state).id;

  return chooseHighestScoringAction(
    state,
    actions,
    (action) => challengeExpectedValue(state, action, rootPlayerId),
    `${difficulty}-challenge`
  );
}

function chooseHardAction(state: GameState, actions: BotAction[]): BotAction {
  const rootPlayerId = currentPlayer(state).id;
  const actionBankSetup = chooseHardActionBankSetup(state, actions, rootPlayerId);

  if (actionBankSetup) {
    return actionBankSetup;
  }
  const rootCandidates = rankedActionsForActor(state, actions, rootPlayerId, HARD_ROOT_PREFILTER, true).slice(
    0,
    HARD_ROOT_BEAM
  );
  const scored = rootCandidates.map((action) => {
    if (usesFutureGameRandomness(state, action)) {
      return {
        action,
        score: expectedStochasticScore(state, action, rootPlayerId, HARD_STOCHASTIC_SAMPLES, true, true)
      };
    }

    const next = applyBotAction(state, action);
    const budget = { remaining: HARD_NODE_BUDGET };
    const changedPlayer = next.phase === "playing" && currentPlayer(next).id !== rootPlayerId;
    const handoffsRemaining = HARD_HANDOFF_DEPTH - (changedPlayer ? 1 : 0);

    return {
      action,
      score: hardSearch(next, rootPlayerId, handoffsRemaining, 1, budget)
    };
  });

  return chooseHighestScored(state, scored, "hard-choice");
}

interface HardActionBankPlan {
  firstAction: Extract<BotAction, { type: "move" }>;
  finalState: GameState;
  moveCount: number;
  utility: number;
}

/**
 * Finds the hard-only "bank actions" tactic: move a board die into a spatial
 * completion, follow the newly emptied square through any further completing
 * moves, then place a tray die into the final vacancy. This lets the bot break
 * completed spatial units and earn them again when it refills that square.
 */
function chooseHardActionBankSetup(
  state: GameState,
  actions: BotAction[],
  playerId: string
): Extract<BotAction, { type: "move" }> | undefined {
  const directPlacementStates = actions
    .filter((action): action is Extract<BotAction, { type: "place" }> => action.type === "place")
    .map((action) => applyBotAction(state, action));

  if (directPlacementStates.some((next) => next.phase === "won" && next.winnerId === playerId)) {
    return undefined;
  }

  const bestDirectUtility = directPlacementStates.reduce(
    (best, next) => Math.max(best, hardActionBankUtility(next, playerId, 0)),
    Number.NEGATIVE_INFINITY
  );
  const setupMoves = actions
    .filter((action): action is Extract<BotAction, { type: "move" }> => action.type === "move")
    .map((action) => {
      const die = state.dice.find((candidate) => candidate.id === action.dieId);

      if (!die || !isOnBoard(die)) {
        return undefined;
      }

      const next = applyBotAction(state, action);

      if (!retainsPlayerTurn(next, playerId) || spatialCompletionCount(next, playerId) === 0) {
        return undefined;
      }

      const continuation = bestHardActionBankContinuation(
        next,
        playerId,
        { row: die.row as number, col: die.col as number },
        HARD_ACTION_BANK_MAX_MOVES - 1
      );

      if (!continuation) {
        return undefined;
      }

      return {
        firstAction: action,
        finalState: continuation.finalState,
        moveCount: continuation.moveCount + 1,
        utility: hardActionBankUtility(continuation.finalState, playerId, continuation.moveCount + 1)
      } satisfies HardActionBankPlan;
    })
    .filter((plan): plan is HardActionBankPlan => Boolean(plan))
    .sort((left, right) => {
      return right.utility - left.utility || actionKey(left.firstAction).localeCompare(actionKey(right.firstAction));
    });
  const bestPlan = setupMoves[0];

  if (!bestPlan || bestPlan.utility < bestDirectUtility + HARD_ACTION_BANK_MIN_ADVANTAGE) {
    return undefined;
  }

  return bestPlan.firstAction;
}

function bestHardActionBankContinuation(
  state: GameState,
  playerId: string,
  vacancy: { row: number; col: number },
  movesRemaining: number
): { finalState: GameState; moveCount: number; utility: number } | undefined {
  const candidates = legalBotActions(state)
    .filter((action): action is Extract<BotAction, { type: "place" | "move" }> => {
      return (action.type === "place" || action.type === "move")
        && action.row === vacancy.row
        && action.col === vacancy.col;
    })
    .map((action) => {
      const movingDie = action.type === "move"
        ? state.dice.find((die) => die.id === action.dieId)
        : undefined;
      const next = applyBotAction(state, action);
      return { action, movingDie, next, completions: spatialCompletionCount(next, playerId) };
    })
    .filter(({ next, completions }) => {
      return completions > 0 && (next.phase === "won" || retainsPlayerTurn(next, playerId));
    })
    .sort((left, right) => {
      return right.completions - left.completions || actionKey(left.action).localeCompare(actionKey(right.action));
    });
  let best: { finalState: GameState; moveCount: number; utility: number } | undefined;

  for (const candidate of candidates) {
    if (candidate.action.type === "place") {
      const utility = hardActionBankUtility(candidate.next, playerId, 0);

      if (!best || utility > best.utility) {
        best = { finalState: candidate.next, moveCount: 0, utility };
      }
      continue;
    }

    if (movesRemaining <= 0 || !candidate.movingDie || !isOnBoard(candidate.movingDie)) {
      continue;
    }

    const continuation = bestHardActionBankContinuation(
      candidate.next,
      playerId,
      { row: candidate.movingDie.row as number, col: candidate.movingDie.col as number },
      movesRemaining - 1
    );

    if (!continuation) {
      continue;
    }

    const moveCount = continuation.moveCount + 1;
    const utility = hardActionBankUtility(continuation.finalState, playerId, moveCount);

    if (!best || utility > best.utility) {
      best = { finalState: continuation.finalState, moveCount, utility };
    }
  }

  return best;
}

function hardActionBankUtility(state: GameState, playerId: string, moveCount: number): number {
  const terminal = terminalStateScore(state, playerId);

  if (terminal !== null) {
    return terminal;
  }

  return evaluateHardState(state, playerId, true)
    + state.actionCredits * HARD_ACTION_BANK_CREDIT_VALUE
    - moveCount * HARD_ACTION_BANK_MOVE_COST;
}

function retainsPlayerTurn(state: GameState, playerId: string): boolean {
  return state.phase === "playing" && currentPlayer(state).id === playerId && state.actionCredits > 0;
}

function spatialCompletionCount(state: GameState, playerId: string): number {
  if (state.lastAction?.playerId !== playerId) {
    return 0;
  }

  return state.lastAction.completedKeys.filter((key) => {
    return key.startsWith("row:") || key.startsWith("column:") || key.startsWith("box:");
  }).length;
}

function hardSearch(
  state: GameState,
  rootPlayerId: string,
  handoffsRemaining: number,
  actionDepth: number,
  budget: { remaining: number }
): number {
  const terminalScore = terminalStateScore(state, rootPlayerId);

  if (terminalScore !== null) {
    return terminalScore;
  }

  if (handoffsRemaining < 0 || actionDepth >= HARD_ACTION_DEPTH || budget.remaining <= 0) {
    return evaluateHardState(state, rootPlayerId, true);
  }

  budget.remaining -= 1;
  const actorId = currentPlayer(state).id;
  const legal = legalBotActions(state);
  const candidates = rankedActionsForActor(
    state,
    strategicActions(state, legal),
    actorId,
    HARD_NODE_PREFILTER,
    true
  ).slice(0, HARD_NODE_BEAM);

  if (candidates.length === 0) {
    return evaluateHardState(state, rootPlayerId, true);
  }

  const maximizing = actorId === rootPlayerId;
  let bestScore = maximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;

  for (const action of candidates) {
    let score: number;

    if (usesFutureGameRandomness(state, action)) {
      score = expectedStochasticScore(state, action, rootPlayerId, HARD_STOCHASTIC_SAMPLES, true, true);
    } else {
      const next = applyBotAction(state, action);
      const changedPlayer = next.phase === "playing" && currentPlayer(next).id !== actorId;
      const nextHandoffs = handoffsRemaining - (changedPlayer ? 1 : 0);
      score = hardSearch(next, rootPlayerId, nextHandoffs, actionDepth + 1, budget);
    }

    bestScore = maximizing ? Math.max(bestScore, score) : Math.min(bestScore, score);

    if (budget.remaining <= 0) {
      break;
    }
  }

  return Number.isFinite(bestScore) ? bestScore : evaluateHardState(state, rootPlayerId, true);
}

function rankedActionsForActor(
  state: GameState,
  actions: BotAction[],
  actorId: string,
  prefilterLimit: number,
  preserveLastValues = false
): BotAction[] {
  return fastActionShortlist(state, actions, actorId, prefilterLimit)
    .map((action) => ({
      action,
      score: preserveLastValues ? hardActionScore(state, action, actorId) : mediumActionScore(state, action, actorId)
    }))
    .sort((left, right) => right.score - left.score || actionKey(left.action).localeCompare(actionKey(right.action)))
    .map(({ action }) => action);
}


function fastActionShortlist(
  state: GameState,
  actions: BotAction[],
  actorId: string,
  limit: number
): BotAction[] {
  if (actions.length <= limit) {
    return actions;
  }

  const dieById = new Map(state.dice.map((die) => [die.id, die]));
  const ranked = actions
    .map((action) => ({
      action,
      family: fastActionFamily(action, dieById),
      score: fastActionScore(state, action, actorId, dieById)
    }))
    .sort((left, right) => right.score - left.score || actionKey(left.action).localeCompare(actionKey(right.action)));
  const perFamily = limit >= 12 ? 2 : 1;
  const familyCounts = new Map<string, number>();
  const selected = new Set<string>();

  for (const candidate of ranked) {
    const familyCount = familyCounts.get(candidate.family) ?? 0;

    if (familyCount < perFamily) {
      selected.add(actionKey(candidate.action));
      familyCounts.set(candidate.family, familyCount + 1);
    }

    if (selected.size >= limit) {
      break;
    }
  }

  for (const candidate of ranked) {
    if (selected.size >= limit) {
      break;
    }

    selected.add(actionKey(candidate.action));
  }

  return ranked.filter(({ action }) => selected.has(actionKey(action))).map(({ action }) => action);
}

function fastActionFamily(action: BotAction, dieById: Map<string, Die>): string {
  if (action.type === "place") {
    return `place:${dieById.get(action.dieId)?.value ?? action.dieId}`;
  }

  return action.type;
}

function fastActionScore(
  state: GameState,
  action: BotAction,
  actorId: string,
  dieById: Map<string, Die>
): number {
  if (action.type === "challenge") {
    return challengeExpectedValue(state, action, actorId);
  }

  if (action.type === "pass") {
    return -WIN_SCORE;
  }

  if (action.type === "reroll") {
    const blockedDice = action.dieIds.reduce((count, dieId) => {
      const die = dieById.get(dieId);
      return count + (die && legalCellCountForValue(state, die.value) === 0 ? 1 : 0);
    }, 0);

    const controlGain = expectedOpponentRerollValueControlGain(state, action, actorId);
    return -3_000 + blockedDice * 2_000 - action.dieIds.length
      + controlGain * HARD_VALUE_CONTROL_WEIGHT;
  }

  const die = dieById.get(action.dieId);

  if (!die) {
    return Number.NEGATIVE_INFINITY;
  }

  const completionCount = fastCompletionCount(state, action, die);
  const targetDensity = state.dice.filter((candidate) => {
    if (!isOnBoard(candidate) || candidate.id === die.id) {
      return false;
    }

    return candidate.row === action.row || candidate.col === action.col ||
      boxIndex(candidate.row as number, candidate.col as number) === boxIndex(action.row, action.col);
  }).length;

  if (action.type === "place") {
    const winningPlacement = remainingDiceCount(state, actorId) === 1;
    return (winningPlacement ? WIN_SCORE / 2 : 20_000) + completionCount * 100_000 + targetDensity * 100;
  }

  return -1_500 + completionCount * 100_000 + targetDensity * 100;
}

function fastCompletionCount(
  state: GameState,
  action: Extract<BotAction, { type: "place" | "move" }>,
  die: Die
): number {
  const targetBox = boxIndex(action.row, action.col);
  const boardExceptMoved = state.dice.filter((candidate) => isOnBoard(candidate) && candidate.id !== die.id);
  let completions = 0;

  if (boardExceptMoved.filter((candidate) => candidate.row === action.row).length === BOARD_SIZE - 1) {
    completions += 1;
  }

  if (boardExceptMoved.filter((candidate) => candidate.col === action.col).length === BOARD_SIZE - 1) {
    completions += 1;
  }

  if (boardExceptMoved.filter((candidate) => {
    return boxIndex(candidate.row as number, candidate.col as number) === targetBox;
  }).length === BOARD_SIZE - 1) {
    completions += 1;
  }

  if (action.type === "place" && state.dice.filter((candidate) => {
    return isOnBoard(candidate) && candidate.value === die.value;
  }).length === BOARD_SIZE - 1) {
    completions += 1;
  }

  return completions;
}

/** Original one-ply medium evaluator, before threat-delta and last-value reserve bonuses. */
function classicMediumActionScore(state: GameState, action: BotAction, rootPlayerId: string): number {
  if (usesFutureGameRandomness(state, action)) {
    let total = 0;

    for (let sample = 0; sample < MEDIUM_STOCHASTIC_SAMPLES; sample += 1) {
      const simulated = cloneForEvaluation(state);
      simulated.rngState = seedToState(`${decisionSignature(state)}|chance:${sample}`);
      const next = applyBotAction(simulated, action);
      total += evaluateState(next, rootPlayerId) + immediateActionValue(simulated, next, action, rootPlayerId);
    }

    return total / MEDIUM_STOCHASTIC_SAMPLES;
  }

  const next = applyBotAction(state, action);
  return evaluateState(next, rootPlayerId) + immediateActionValue(state, next, action, rootPlayerId);
}

function mediumActionScore(state: GameState, action: BotAction, rootPlayerId: string): number {
  if (usesFutureGameRandomness(state, action)) {
    return expectedStochasticScore(state, action, rootPlayerId, MEDIUM_STOCHASTIC_SAMPLES, true);
  }

  const next = applyBotAction(state, action);
  return actionEvaluation(state, next, action, rootPlayerId, true);
}

function hardActionScore(state: GameState, action: BotAction, rootPlayerId: string): number {
  if (usesFutureGameRandomness(state, action)) {
    return expectedStochasticScore(state, action, rootPlayerId, HARD_STOCHASTIC_SAMPLES, true, true);
  }
  return actionEvaluation(state, applyBotAction(state, action), action, rootPlayerId, true, true);
}

function expectedStochasticScore(
  state: GameState,
  action: BotAction,
  rootPlayerId: string,
  sampleCount: number,
  preserveLastValues = false,
  allOpponentThreats = false
): number {
  let total = 0;

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const simulated = cloneForEvaluation(state);

    // Deliberately replace, rather than advance or inspect, the real game RNG.
    // These independent samples estimate a fair outcome without letting a bot
    // predict the persisted reroll/challenge result.
    simulated.rngState = seedToState(`${decisionSignature(state)}|chance:${sample}`);
    const next = applyBotAction(simulated, action);
    total += actionEvaluation(simulated, next, action, rootPlayerId, preserveLastValues, allOpponentThreats);
  }

  return total / sampleCount;
}

function actionEvaluation(
  before: GameState,
  after: GameState,
  action: BotAction,
  rootPlayerId: string,
  preserveLastValues: boolean,
  allOpponentThreats = false
): number {
  const baseScore = preserveLastValues
    ? evaluateHardState(after, rootPlayerId, allOpponentThreats)
    : evaluateState(after, rootPlayerId);
  const nextPlayerId = after.phase === "playing" && currentPlayer(after).id !== rootPlayerId
    ? currentPlayer(after).id
    : undefined;
  const newlyCreatedThreat = !allOpponentThreats && nextPlayerId
    ? Math.max(0, completionThreatScore(after, nextPlayerId) - completionThreatScore(before, nextPlayerId))
    : 0;
  return baseScore + immediateActionValue(before, after, action, rootPlayerId) - newlyCreatedThreat;
}

function immediateActionValue(before: GameState, after: GameState, action: BotAction, playerId: string): number {
  if (after.phase === "won") {
    return after.winnerId === playerId ? WIN_SCORE / 2 : -WIN_SCORE / 2;
  }

  const placedDice = remainingDiceCount(before, playerId) - remainingDiceCount(after, playerId);
  const completed = after.lastAction?.playerId === playerId ? after.lastAction.completedKeys.length : 0;
  const retainedTurn = after.phase === "playing" && currentPlayer(after).id === playerId;
  let score = placedDice * 8_000 + completed * 7_000 + (completed > 0 && retainedTurn ? 3_000 : 0);

  if (action.type === "place") {
    score += 750;
  } else if (action.type === "move" && completed === 0) {
    score -= 1_500;
  } else if (action.type === "reroll") {
    score -= 2_500;
    if (isOpeningValueControlState(before)) {
      score += (valueControlStrength(after, playerId) - valueControlStrength(before, playerId))
        * HARD_VALUE_CONTROL_WEIGHT;
    }
  } else if (action.type === "pass") {
    score -= 8_000;
  }

  return score;
}

function evaluateState(state: GameState, rootPlayerId: string): number {
  const terminalScore = terminalStateScore(state, rootPlayerId);

  if (terminalScore !== null) {
    return terminalScore;
  }

  const rootRemaining = remainingDiceCount(state, rootPlayerId);
  const legalCellsByValue = new Map<DiceValue, number>(
    DICE_VALUES.map((value) => [value, legalCellCountForValue(state, value)])
  );
  let score = -rootRemaining * 12_000;

  state.players.forEach((player) => {
    const remaining = remainingDiceCount(state, player.id);
    const flexibility = offBoardDice(state, player.id).reduce(
      (total, die) => total + (legalCellsByValue.get(die.value) ?? 0),
      0
    );
    const opportunity = completionOpportunityScore(state, player.id);

    if (player.id === rootPlayerId) {
      score += flexibility * 7 + opportunity;

      if (remaining === 1 && hasWinningPlacement(state, player.id)) {
        score += 35_000;
      }
    } else {
      score += remaining * 2_500 - flexibility * 1.5 - opportunity * 0.35;

      if (remaining === 1 && hasWinningPlacement(state, player.id)) {
        score -= 45_000;
      }
    }
  });

  if (currentPlayer(state).id === rootPlayerId) {
    score += Math.max(0, state.actionCredits) * 500;
  }

  return score;
}

function terminalStateScore(state: GameState, rootPlayerId: string): number | null {
  if (state.phase !== "won") {
    return null;
  }

  return state.winnerId === rootPlayerId ? WIN_SCORE : -WIN_SCORE;
}

function evaluateHardState(state: GameState, rootPlayerId: string, allOpponentThreats = false): number {
  const opponentThreatPenalty = state.phase === "playing" && allOpponentThreats
    ? allOpponentCompletionThreatScore(state, rootPlayerId)
    : 0;
  return evaluateState(state, rootPlayerId)
    + (state.phase === "playing" ? hardValueReserveScore(state, rootPlayerId) : 0)

    - opponentThreatPenalty;
}

/**
 * Scores values controlled exclusively by one player. Squaring the owned count
 * makes breaking an opponent's final matching die more valuable when it creates
 * a larger monopoly, while still recognizing control that starts with one die.
 */
export function isOpeningValueControlState(state: GameState): boolean {
  const withinOpeningRounds = state.turnNumber <= state.players.length * 2;
  return withinOpeningRounds
    && state.dice.filter(isOnBoard).length <= OPENING_VALUE_CONTROL_MAX_BOARD_DICE;
}

export function valueControlStrength(state: GameState, playerId: string): number {
  const owned = new Map<DiceValue, number>();
  const opposing = new Map<DiceValue, number>();
  state.dice.forEach((die) => {
    const counts = die.ownerId === playerId ? owned : opposing;
    counts.set(die.value, (counts.get(die.value) ?? 0) + 1);
  });
  return DICE_VALUES.reduce((score, value) => {
    return score + valueControlContribution(owned.get(value) ?? 0, opposing.get(value) ?? 0);
  }, 0);
}

/** Expected change in value control from a legal single-opponent-die reroll. */
export function expectedOpponentRerollValueControlGain(
  state: GameState,
  action: BotAction,
  playerId: string
): number {
  if (action.type !== "reroll" || action.dieIds.length !== 1) return 0;
  const target = state.dice.find((die) => die.id === action.dieIds[0]);
  if (!target || target.ownerId === playerId || !isOpeningValueControlState(state)) return 0;

  const owned = new Map<DiceValue, number>();
  const opposing = new Map<DiceValue, number>();
  state.dice.forEach((die) => {
    const counts = die.ownerId === playerId ? owned : opposing;
    counts.set(die.value, (counts.get(die.value) ?? 0) + 1);
  });
  const contribution = (value: DiceValue, opposingCount: number) =>
    valueControlContribution(owned.get(value) ?? 0, opposingCount);
  const oldValue = target.value;
  const oldOpposing = opposing.get(oldValue) ?? 0;
  let totalDelta = 0;
  DICE_VALUES.forEach((newValue) => {
    if (newValue === oldValue) return;
    const newOpposing = opposing.get(newValue) ?? 0;
    totalDelta += contribution(oldValue, oldOpposing - 1) - contribution(oldValue, oldOpposing);
    totalDelta += contribution(newValue, newOpposing + 1) - contribution(newValue, newOpposing);
  });
  return totalDelta / DICE_VALUES.length;
}

/** Expected reduction in legal placements when rerolling an opponent's final die. */
export function expectedOpponentRerollThreatReduction(
  state: GameState,
  action: BotAction,
  playerId: string
): number {
  if (action.type !== "reroll" || action.dieIds.length !== 1) return 0;
  const target = state.dice.find((die) => die.id === action.dieIds[0]);
  if (!target || target.ownerId === playerId || remainingDiceCount(state, target.ownerId) !== 1) return 0;

  const currentOptions = legalCellCountForValue(state, target.value);
  const expectedOptions = DICE_VALUES.reduce(
    (sum, value) => sum + legalCellCountForValue(state, value),
    0
  ) / DICE_VALUES.length;
  return Math.max(0, currentOptions - expectedOptions);
}

export function isTacticalOpponentRerollAction(
  state: GameState,
  action: BotAction,
  playerId: string
): boolean {
  return expectedOpponentRerollValueControlGain(state, action, playerId) > 0
    || expectedOpponentRerollThreatReduction(state, action, playerId) > 0;
}

function valueControlContribution(owned: number, opposing: number): number {
  return owned >= 1 && opposing === 0 ? owned * 4 : 0;
}
function hardValueReserveScore(state: GameState, playerId: string): number {
  const counts = new Map<DiceValue, number>();
  offBoardDice(state, playerId).forEach((die) => counts.set(die.value, (counts.get(die.value) ?? 0) + 1));
  return DICE_VALUES.reduce((score, value) => {
    const count = counts.get(value) ?? 0;
    if (count === 0) return score;
    let valueScore = HARD_VALUE_PRESENCE_BONUS;
    if (count === 1) {
      valueScore += HARD_LAST_VALUE_RESERVE_BONUS;
      const placed = state.dice.filter((die) => isOnBoard(die) && die.value === value).length;
      if (placed >= 4 && legalCellCountForValue(state, value) > 0) valueScore += HARD_NEAR_VALUE_SET_RESERVE_BONUS;
    }
    return score + valueScore;
  }, 0);
}

function allOpponentCompletionThreatScore(state: GameState, rootPlayerId: string): number {
  const rootIndex = state.players.findIndex((player) => player.id === rootPlayerId);

  if (rootIndex < 0) {
    return 0;
  }

  let score = 0;
  for (let offset = 1; offset < state.players.length; offset += 1) {
    const opponent = state.players[(rootIndex + offset) % state.players.length];
    const completionPenalty = offset === 1
      ? NEXT_PLAYER_COMPLETION_THREAT_PENALTY
      : ADDITIONAL_COMPLETION_THREAT_PENALTY;
    score += completionThreatScore(state, opponent.id, completionPenalty);
  }
  return score;
}

function completionThreatScore(
  state: GameState,
  playerId: string,
  completionPenalty = NEXT_PLAYER_COMPLETION_THREAT_PENALTY
): number {
  const values = new Set(offBoardDice(state, playerId).map((die) => die.value));
  if (values.size === 0) return 0;
  const units: Array<Array<{ row: number; col: number }>> = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) units.push(Array.from({ length: BOARD_SIZE }, (_, col) => ({ row, col })));
  for (let col = 0; col < BOARD_SIZE; col += 1) units.push(Array.from({ length: BOARD_SIZE }, (_, row) => ({ row, col })));
  for (let box = 0; box < BOARD_SIZE; box += 1) {
    const boxRow = Math.floor(box / 3) * 3;
    const boxCol = (box % 3) * 2;
    const cells: Array<{ row: number; col: number }> = [];
    for (let row = boxRow; row < boxRow + 3; row += 1) {
      for (let col = boxCol; col < boxCol + 2; col += 1) cells.push({ row, col });
    }
    units.push(cells);
  }
  let threats = 0;
  units.forEach((unit) => {
    const empty = unit.filter(({ row, col }) => !getDieAt(state, row, col));
    if (empty.length === 1 && [...values].some((value) => canPlaceValueAt(state, value, empty[0].row, empty[0].col))) threats += 1;
  });
  DICE_VALUES.forEach((value) => {
    const placed = state.dice.filter((die) => isOnBoard(die) && die.value === value).length;
    if (values.has(value) && placed === 5 && legalCellCountForValue(state, value) > 0) threats += 1;
  });
  return threats * completionPenalty
    + (remainingDiceCount(state, playerId) === 1 && threats > 0 ? NEXT_PLAYER_WIN_THREAT_PENALTY : 0);
}

function completionOpportunityScore(state: GameState, playerId: string): number {
  const trayValues = new Set(offBoardDice(state, playerId).map((die) => die.value));

  if (trayValues.size === 0) {
    return 0;
  }

  const units: Array<Array<{ row: number; col: number }>> = [];

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    units.push(Array.from({ length: BOARD_SIZE }, (_, col) => ({ row, col })));
  }

  for (let col = 0; col < BOARD_SIZE; col += 1) {
    units.push(Array.from({ length: BOARD_SIZE }, (_, row) => ({ row, col })));
  }

  for (let box = 0; box < BOARD_SIZE; box += 1) {
    const boxRow = Math.floor(box / 3) * 3;
    const boxCol = (box % 3) * 2;
    const cells: Array<{ row: number; col: number }> = [];

    for (let row = boxRow; row < boxRow + 3; row += 1) {
      for (let col = boxCol; col < boxCol + 2; col += 1) {
        cells.push({ row, col });
      }
    }

    units.push(cells);
  }

  let score = 0;

  units.forEach((unit) => {
    const occupiedCount = unit.filter(({ row, col }) => Boolean(getDieAt(state, row, col))).length;

    if (occupiedCount < 3 || occupiedCount >= BOARD_SIZE) {
      return;
    }

    const canFinish = unit.some(({ row, col }) => {
      return !getDieAt(state, row, col) && [...trayValues].some((value) => canPlaceValueAt(state, value, row, col));
    });

    if (canFinish) {
      score += occupiedCount === 5 ? 1_500 : occupiedCount === 4 ? 300 : 60;
    }
  });

  DICE_VALUES.forEach((value) => {
    if (!trayValues.has(value)) {
      return;
    }

    const count = state.dice.filter((die) => isOnBoard(die) && die.value === value).length;

    if (count === 5 && (legalCellCountForValue(state, value) > 0)) {
      score += 1_500;
    } else if (count === 4 && (legalCellCountForValue(state, value) > 0)) {
      score += 300;
    }
  });

  return score;
}

function hasWinningPlacement(state: GameState, playerId: string): boolean {
  const tray = offBoardDice(state, playerId);

  if (tray.length !== 1) {
    return false;
  }

  return legalCellCountForValue(state, tray[0].value) > 0;
}

function legalCellCountForValue(state: GameState, value: DiceValue): number {
  return boardCells().filter(({ row, col }) => canPlaceValueAt(state, value, row, col)).length;
}

function canPlaceValueAt(state: GameState, value: DiceValue, row: number, col: number): boolean {
  if (getDieAt(state, row, col)) {
    return false;
  }

  const targetBox = boxIndex(row, col);

  return !state.dice.some((die) => {
    return (
      isOnBoard(die) &&
      die.value === value &&
      (die.row === row || die.col === col || boxIndex(die.row as number, die.col as number) === targetBox)
    );
  });
}

function challengeExpectedValue(
  state: GameState,
  action: Extract<BotAction, { type: "challenge" }>,
  rootPlayerId: string
): number {
  const involvedDice = diceInTargetedConflicts(state, action.targetDieId);
  const immediateDie = state.lastAction?.dieId
    ? involvedDice.find((die) => die.id === state.lastAction?.dieId)
    : undefined;

  if (immediateDie) {
    return immediateDie.ownerId === rootPlayerId ? -20_000 : 20_000;
  }

  const ownerIds = [...new Set(involvedDice.map((die) => die.ownerId))];

  if (ownerIds.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  if (ownerIds.length === 1) {
    return ownerIds[0] === rootPlayerId ? -15_000 : 15_000;
  }

  const rootLossProbability = ownerIds.includes(rootPlayerId) ? 1 / ownerIds.length : 0;
  return (1 - rootLossProbability) * 8_000 - rootLossProbability * 12_000;
}

function usesFutureGameRandomness(state: GameState, action: BotAction): boolean {
  if (action.type === "reroll") {
    return true;
  }

  if (action.type !== "challenge") {
    return false;
  }

  const involvedDice = diceInTargetedConflicts(state, action.targetDieId);

  if (state.lastAction?.dieId && involvedDice.some((die) => die.id === state.lastAction?.dieId)) {
    return false;
  }

  return new Set(involvedDice.map((die) => die.ownerId)).size > 1;
}

function diceInTargetedConflicts(state: GameState, targetDieId: string): Die[] {
  const ids = new Set(
    detectConflicts(state)
      .filter((conflict) => conflict.dieIds.includes(targetDieId))
      .flatMap((conflict) => conflict.dieIds)
  );

  return state.dice.filter((die) => ids.has(die.id));
}

function strategicActions(state: GameState, actions: BotAction[]): BotAction[] {
  const dieById = new Map(state.dice.map((die) => [die.id, die]));
  const actorId = currentPlayer(state).id;
  const seen = new Set<string>();
  const strategic: BotAction[] = [];

  actions.forEach((action) => {
    const targetsOpponent = action.type === "reroll"
      && action.dieIds.some((dieId) => dieById.get(dieId)?.ownerId !== actorId);
    if (targetsOpponent && !isTacticalOpponentRerollAction(state, action, actorId)) {
      return;
    }

    let key = actionKey(action);

    if (action.type === "place") {
      const die = dieById.get(action.dieId);
      key = `place:${die?.value ?? action.dieId}:${action.row}:${action.col}`;
    }

    if (!seen.has(key)) {
      seen.add(key);
      strategic.push(action);
    }
  });

  return strategic;
}

function rerollCandidateIds(trayDice: Die[]): string[][] {
  if (trayDice.length === 0) {
    return [];
  }

  const candidates: string[][] = [];
  const seen = new Set<string>();
  const add = (dieIds: string[]) => {
    const sortedIds = [...dieIds].sort((left, right) => left.localeCompare(right));
    const key = sortedIds.join("|");

    if (sortedIds.length > 0 && !seen.has(key)) {
      seen.add(key);
      candidates.push(sortedIds);
    }
  };

  add(trayDice.map((die) => die.id));
  trayDice.forEach((die) => add([die.id]));
  DICE_VALUES.forEach((value) => add(trayDice.filter((die) => die.value === value).map((die) => die.id)));

  return candidates;
}

function chooseHighestScoringAction<TAction extends BotAction>(
  state: GameState,
  actions: TAction[],
  scoreAction: (action: TAction) => number,
  salt: string
): TAction {
  const scored = actions.map((action) => ({ action, score: scoreAction(action) }));
  return chooseHighestScored(state, scored, salt) as TAction;
}

function chooseHighestScored(
  state: GameState,
  scored: Array<{ action: BotAction; score: number }>,
  salt: string
): BotAction {
  const bestScore = Math.max(...scored.map(({ score }) => score));
  const bestActions = scored
    .filter(({ score }) => Math.abs(score - bestScore) < 0.000_001)
    .map(({ action }) => action)
    .sort((left, right) => actionKey(left).localeCompare(actionKey(right)));

  return pickDeterministically(state, bestActions, salt);
}

function pickDeterministically<T>(state: GameState, values: T[], salt: string): T {
  const index = Math.min(values.length - 1, Math.floor(deterministicRandom(state, salt) * values.length));
  return values[index];
}

function deterministicRandom(state: GameState, salt: string): number {
  return nextRandom(seedToState(`${decisionSignature(state)}|${salt}`)).value;
}

function decisionSignature(state: GameState): string {
  const dice = [...state.dice]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((die) => `${die.id}:${die.ownerId}:${die.value}:${die.row ?? "t"}:${die.col ?? "t"}`)
    .join(",");
  const changes = (state.boardChanges ?? [])
    .map((change) => `${change.type}:${change.playerId}:${change.dieId}:${change.turnNumber}`)
    .join(",");

  // rngState is intentionally absent. Bot choices must not learn or consume the
  // engine's future reroll/challenge stream.
  return [
    state.seed,
    state.currentPlayerIndex,
    state.turnNumber,
    state.actionCredits,
    state.phase,
    dice,
    changes,
    state.lastAction?.type ?? "none",
    state.lastAction?.dieId ?? "none"
  ].join("|");
}

function progressKey(state: GameState): string {
  return [
    state.phase,
    state.winnerId ?? "",
    state.currentPlayerIndex,
    state.turnNumber,
    state.actionCredits,
    state.rngState,
    state.dice.map((die) => `${die.id}:${die.value}:${die.row ?? "t"}:${die.col ?? "t"}`).join(","),
    state.lastAction?.type ?? "none",
    state.lastAction?.dieId ?? "none"
  ].join("|");
}

function actionKey(action: BotAction): string {
  switch (action.type) {
    case "place":
    case "move":
      return `${action.type}:${action.dieId}:${action.row}:${action.col}`;
    case "reroll":
      return `reroll:${[...action.dieIds].sort((left, right) => left.localeCompare(right)).join(",")}`;
    case "challenge":
      return `challenge:${action.targetDieId}`;
    case "pass":
      return "pass";
  }
}

function difficultyForPlayer(player: Player): BotDifficulty | undefined {
  return player.controller.kind === "bot" ? player.controller.difficulty : undefined;
}

function cloneForEvaluation(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function boardCells(): Array<{ row: number; col: number }> {
  const cells: Array<{ row: number; col: number }> = [];

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      cells.push({ row, col });
    }
  }

  return cells;
}
const NEXT_PLAYER_COMPLETION_THREAT_PENALTY = 18_000;
const ADDITIONAL_COMPLETION_THREAT_PENALTY = 30_000;
const NEXT_PLAYER_WIN_THREAT_PENALTY = 90_000;
const HARD_VALUE_PRESENCE_BONUS = 700;
const HARD_LAST_VALUE_RESERVE_BONUS = 2_400;
const HARD_NEAR_VALUE_SET_RESERVE_BONUS = 1_200;
