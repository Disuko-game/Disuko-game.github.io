import { boxIndex, cellKey, cellsForBox, isInBounds } from "./geometry";
import { rollDie, seedToState } from "./rng";
import {
  BOARD_SIZE,
  BOX_COUNT,
  DICE_VALUES,
  PLAYER_COLORS,
  type ActionMode,
  type BoardChange,
  type BoardChangeType,
  type ChallengeRoll,
  type Completion,
  type Conflict,
  type DiceValue,
  type Die,
  type GameState,
  type LastActionType,
  type NewGameOptions,
  type Player
} from "./types";

export function diceCountForPlayerCount(playerCount: 2 | 3 | 4): number {
  if (playerCount === 2) {
    return 18;
  }

  if (playerCount === 3) {
    return 12;
  }

  return 9;
}

export function newGame(options: NewGameOptions): GameState {
  const seed = options.seed ?? `${Date.now()}`;
  let rngState = seedToState(seed);
  const dicePerPlayer = diceCountForPlayerCount(options.playerCount);
  const players: Player[] = Array.from({ length: options.playerCount }, (_, index) => ({
    id: `p${index + 1}`,
    name: `Player ${index + 1}`,
    color: PLAYER_COLORS[index]
  }));
  const dice: Die[] = [];

  players.forEach((player) => {
    for (let index = 0; index < dicePerPlayer; index += 1) {
      const roll = rollDie(rngState);
      rngState = roll.state;
      dice.push({
        id: `${player.id}-d${index + 1}`,
        ownerId: player.id,
        value: roll.value,
        row: null,
        col: null
      });
    }
  });

  return {
    version: 1,
    seed,
    rngState,
    players,
    dice,
    tabletopMode: options.tabletopMode ?? false,
    currentPlayerIndex: 0,
    turnNumber: 1,
    actionCredits: 1,
    mode: "place",
    selectedDieIds: [],
    completedKeys: [],
    phase: "playing",
    message: `${players[0].name}, place a die, move a die, or reroll your tray.`,
    lastAction: undefined,
    boardChanges: [],
    challengeRolls: undefined
  };
}

export function currentPlayer(state: GameState): Player {
  return state.players[state.currentPlayerIndex];
}

export function getDieAt(state: GameState, row: number, col: number): Die | undefined {
  return state.dice.find((die) => die.row === row && die.col === col);
}

export function isOnBoard(die: Die): boolean {
  return die.row !== null && die.col !== null;
}

export function wouldPlaceDieConflict(state: GameState, dieId: string, row: number, col: number): boolean {
  const die = state.dice.find((candidate) => candidate.id === dieId);

  if (!die || isOnBoard(die) || !isInBounds(row, col) || getDieAt(state, row, col)) {
    return false;
  }

  const targetBox = boxIndex(row, col);

  return state.dice.some((candidate) => {
    if (candidate.id === die.id || !isOnBoard(candidate) || candidate.value !== die.value) {
      return false;
    }

    return candidate.row === row || candidate.col === col || boxIndex(candidate.row as number, candidate.col as number) === targetBox;
  });
}

export function wouldMoveDieConflict(state: GameState, dieId: string, row: number, col: number): boolean {
  const die = state.dice.find((candidate) => candidate.id === dieId);

  if (!die || !isOnBoard(die) || !isInBounds(row, col) || getDieAt(state, row, col)) {
    return false;
  }

  const targetBox = boxIndex(row, col);

  return state.dice.some((candidate) => {
    if (candidate.id === die.id || !isOnBoard(candidate) || candidate.value !== die.value) {
      return false;
    }

    return candidate.row === row || candidate.col === col || boxIndex(candidate.row as number, candidate.col as number) === targetBox;
  });
}

export function wasDieMovedThisTurn(state: GameState, dieId: string): boolean {
  const player = currentPlayer(state);

  return (state.boardChanges ?? []).some(
    (change) =>
      change.type === "move" &&
      change.dieId === dieId &&
      change.playerId === player.id &&
      change.turnNumber === state.turnNumber
  );
}

export function setMode(state: GameState, mode: ActionMode): GameState {
  const next = cloneState(state);
  next.mode = mode;
  next.selectedDieIds = [];
  next.message =
    mode === "challenge"
      ? "Challenge a conflict on the board."
      : `${capitalize(mode)} mode selected.`;
  return next;
}

export function selectDie(state: GameState, dieId: string, multi = false): GameState {
  const next = cloneState(state);
  const die = next.dice.find((candidate) => candidate.id === dieId);

  if (!die || next.phase !== "playing" || (die.ownerId !== currentPlayer(next).id && !isOnBoard(die))) {
    return next;
  }

  if (!multi) {
    next.selectedDieIds = [dieId];
    return next;
  }

  next.selectedDieIds = next.selectedDieIds.includes(dieId)
    ? next.selectedDieIds.filter((id) => id !== dieId)
    : [...next.selectedDieIds, dieId];

  return next;
}

export function setSelectedRerollDice(state: GameState, dieIds: string[]): GameState {
  const next = cloneState(state);
  const player = currentPlayer(next);
  const requestedIds = new Set(dieIds);

  next.mode = "reroll";
  next.selectedDieIds = next.dice
    .filter((die) => requestedIds.has(die.id) && die.ownerId === player.id && !isOnBoard(die))
    .map((die) => die.id);

  return next;
}

export function placeDie(state: GameState, dieId: string, row: number, col: number): GameState {
  const next = cloneState(state);
  const player = currentPlayer(next);
  const die = next.dice.find((candidate) => candidate.id === dieId);
  const previousCompletions = calculateCompletionKeys(next);

  if (!canTakeAction(next)) {
    return withMessage(next, "No action is available. End the action to continue.");
  }

  if (!die || die.ownerId !== player.id || isOnBoard(die)) {
    return withMessage(next, "Select one of your off-board dice to place.");
  }

  if (!isInBounds(row, col) || getDieAt(next, row, col)) {
    return withMessage(next, "Choose an empty board space.");
  }

  if (wouldPlaceDieConflict(next, die.id, row, col)) {
    return resolveInvalidPlacement(next, die.id, player.id);
  }

  die.row = row;
  die.col = col;
  recordBoardChange(next, "place", die.id, player.id);
  return resolveAction(next, "place", die.id, `${player.name} placed a ${die.value}.`, previousCompletions);
}

export function moveDie(state: GameState, dieId: string, row: number, col: number): GameState {
  const next = cloneState(state);
  const player = currentPlayer(next);
  const die = next.dice.find((candidate) => candidate.id === dieId);
  const owner = next.players.find((candidate) => candidate.id === die?.ownerId);
  const previousCompletions = calculateCompletionKeys(next);

  if (!canTakeAction(next)) {
    return withMessage(next, "No action is available. End the action to continue.");
  }

  if (!die || !isOnBoard(die)) {
    return withMessage(next, "Select a board die to move.");
  }

  if (wasDieMovedThisTurn(next, die.id)) {
    return withMessage(next, "That die has already been moved this turn.");
  }

  if (!isInBounds(row, col) || getDieAt(next, row, col)) {
    return withMessage(next, "Move to an empty board space.");
  }

  if (wouldMoveDieConflict(next, die.id, row, col)) {
    return resolveInvalidMove(next, die.id, player.id);
  }

  die.row = row;
  die.col = col;
  recordBoardChange(next, "move", die.id, player.id);
  const movedLabel =
    owner && owner.id !== player.id ? `${player.name} moved ${owner.name}'s ${die.value}.` : `${player.name} moved a ${die.value}.`;

  return resolveAction(next, "move", die.id, movedLabel, previousCompletions);
}

export function rerollDice(
  state: GameState,
  dieIds: string[],
  options: { defaultToAll?: boolean } = {}
): GameState {
  const next = cloneState(state);
  const player = currentPlayer(next);
  const previousCompletions = calculateCompletionKeys(next);
  const defaultToAll = options.defaultToAll ?? true;
  const requestedIds = dieIds.length > 0 || !defaultToAll ? dieIds : offBoardDice(next, player.id).map((die) => die.id);
  const diceToRoll = next.dice.filter(
    (die) => requestedIds.includes(die.id) && die.ownerId === player.id && !isOnBoard(die)
  );

  if (!canTakeAction(next)) {
    return withMessage(next, "No action is available. End the action to continue.");
  }

  if (diceToRoll.length === 0) {
    return withMessage(next, defaultToAll ? "There are no off-board dice selected to reroll." : "Choose dice to reroll.");
  }

  diceToRoll.forEach((die) => {
    const rolled = rollDie(next.rngState);
    next.rngState = rolled.state;
    die.value = rolled.value;
  });

  return resolveAction(next, "reroll", undefined, `${player.name} rerolled ${diceToRoll.length} dice.`, previousCompletions);
}

export function challengeViolation(state: GameState, targetDieId?: string): GameState {
  const next = cloneState(state);
  const allConflicts = detectConflicts(next);
  const conflicts = targetDieId
    ? allConflicts.filter((conflict) => conflict.dieIds.includes(targetDieId))
    : allConflicts;
  const conflictDieIds = new Set(conflicts.flatMap((conflict) => conflict.dieIds));

  if (allConflicts.length === 0) {
    return withMessage(next, "No conflicts are on the board right now.");
  }

  if (conflicts.length === 0) {
    return withMessage(next, "Select a conflicting die to challenge.");
  }

  if (next.lastAction?.dieId && conflictDieIds.has(next.lastAction.dieId)) {
    const offendingDie = next.dice.find((die) => die.id === next.lastAction?.dieId);

    if (offendingDie) {
      const offender = next.players.find((player) => player.id === offendingDie.ownerId);
      offendingDie.row = null;
      offendingDie.col = null;
      next.phase = "playing";
      next.winnerId = undefined;
      next.currentPlayerIndex =
        (next.players.findIndex((player) => player.id === offendingDie.ownerId) + 1) % next.players.length;
      next.turnNumber += 1;
      next.actionCredits = 1;
      next.mode = "place";
      next.selectedDieIds = [];
      next.challengeRolls = undefined;
      next.lastAction = {
        type: "challenge",
        playerId: currentPlayer(next).id,
        dieId: offendingDie.id,
        completedKeys: [],
        conflictDieIds: [...conflictDieIds]
      };
      next.message = `${offender?.name ?? "A player"} returned the challenged die. ${currentPlayer(next).name} is up.`;
      return next;
    }
  }

  return resolveLateChallenge(next, [...conflictDieIds]);
}

export function endAction(state: GameState): GameState {
  const next = cloneState(state);

  if (next.phase === "won") {
    return next;
  }

  next.lastAction = {
    type: "pass",
    playerId: currentPlayer(next).id,
    completedKeys: [],
    conflictDieIds: []
  };

  return advanceTurn(next, `${currentPlayer(next).name} ended the action.`);
}

export function detectConflicts(state: GameState): Conflict[] {
  const conflicts: Conflict[] = [];
  const boardDice = state.dice.filter(isOnBoard);

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    pushUnitConflicts(conflicts, "row", row, boardDice.filter((die) => die.row === row));
  }

  for (let col = 0; col < BOARD_SIZE; col += 1) {
    pushUnitConflicts(conflicts, "column", col, boardDice.filter((die) => die.col === col));
  }

  for (let index = 0; index < BOX_COUNT; index += 1) {
    const boxCells = new Set(cellsForBox(index).map((cell) => cellKey(cell.row, cell.col)));
    pushUnitConflicts(
      conflicts,
      "box",
      index,
      boardDice.filter((die) => die.row !== null && die.col !== null && boxCells.has(cellKey(die.row, die.col)))
    );
  }

  return conflicts;
}

export function conflictDieIds(state: GameState): Set<string> {
  return new Set(detectConflicts(state).flatMap((conflict) => conflict.dieIds));
}

export function conflictCellKeys(state: GameState): Set<string> {
  return new Set(detectConflicts(state).flatMap((conflict) => conflict.cellKeys));
}

export function recentBoardChangesForCurrentTurn(state: GameState): BoardChange[] {
  const previousTurnNumber = state.turnNumber - state.players.length;
  const currentTurnNumber = state.turnNumber;
  const boardDieIds = new Set(state.dice.filter(isOnBoard).map((die) => die.id));
  const latestByDie = new Map<string, BoardChange>();

  (state.boardChanges ?? [])
    .filter((change) => {
      return (
        change.turnNumber > previousTurnNumber &&
        change.turnNumber < currentTurnNumber &&
        boardDieIds.has(change.dieId)
      );
    })
    .forEach((change) => {
      latestByDie.set(change.dieId, change);
    });

  return [...latestByDie.values()];
}

export function calculateCompletionKeys(state: GameState): Completion[] {
  const completions: Completion[] = [];
  const occupied = new Set(
    state.dice
      .filter(isOnBoard)
      .map((die) => {
        return cellKey(die.row as number, die.col as number);
      })
  );

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    if (range(BOARD_SIZE).every((col) => occupied.has(cellKey(row, col)))) {
      completions.push({ key: `row:${row}`, kind: "row", index: row });
    }
  }

  for (let col = 0; col < BOARD_SIZE; col += 1) {
    if (range(BOARD_SIZE).every((row) => occupied.has(cellKey(row, col)))) {
      completions.push({ key: `column:${col}`, kind: "column", index: col });
    }
  }

  for (let index = 0; index < BOX_COUNT; index += 1) {
    if (cellsForBox(index).every((cell) => occupied.has(cellKey(cell.row, cell.col)))) {
      completions.push({ key: `box:${index}`, kind: "box", index });
    }
  }

  DICE_VALUES.forEach((value) => {
    const count = state.dice.filter((die) => isOnBoard(die) && die.value === value).length;

    if (count >= BOARD_SIZE) {
      completions.push({ key: `value:${value}`, kind: "value", index: value });
    }
  });

  return completions;
}

export function serializeGame(state: GameState): string {
  return JSON.stringify(state);
}

export function restoreGame(serialized: string): GameState {
  const parsed = JSON.parse(serialized) as Partial<GameState>;

  if (parsed.version !== 1 || !Array.isArray(parsed.players) || !Array.isArray(parsed.dice)) {
    throw new Error("Saved Disuko game is not compatible with this version.");
  }

  return {
    ...parsed,
    version: 1,
    seed: parsed.seed ?? "restored",
    rngState: parsed.rngState ?? seedToState("restored"),
    players: parsed.players,
    dice: parsed.dice,
    tabletopMode: parsed.tabletopMode ?? false,
    currentPlayerIndex: parsed.currentPlayerIndex ?? 0,
    turnNumber: parsed.turnNumber ?? 1,
    actionCredits: parsed.actionCredits ?? 1,
    mode: parsed.mode ?? "place",
    selectedDieIds: parsed.selectedDieIds ?? [],
    completedKeys: parsed.completedKeys ?? [],
    phase: parsed.phase ?? "playing",
    message: parsed.message ?? "Game restored.",
    boardChanges: parsed.boardChanges ?? []
  } as GameState;
}

export function offBoardDice(state: GameState, playerId: string): Die[] {
  return state.dice.filter((die) => die.ownerId === playerId && !isOnBoard(die));
}

export function boardDiceForPlayer(state: GameState, playerId: string): Die[] {
  return state.dice.filter((die) => die.ownerId === playerId && isOnBoard(die));
}

export function remainingDiceCount(state: GameState, playerId: string): number {
  return offBoardDice(state, playerId).length;
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player })),
    dice: state.dice.map((die) => ({ ...die })),
    selectedDieIds: [...state.selectedDieIds],
    completedKeys: [...state.completedKeys],
    lastAction: state.lastAction ? { ...state.lastAction, completedKeys: [...state.lastAction.completedKeys], conflictDieIds: [...state.lastAction.conflictDieIds] } : undefined,
    boardChanges: (state.boardChanges ?? []).map((change) => ({ ...change })),
    challengeRolls: state.challengeRolls?.map((roll) => ({ ...roll }))
  };
}

function recordBoardChange(state: GameState, type: BoardChangeType, dieId: string, playerId: string): void {
  state.boardChanges ??= [];
  state.boardChanges.push({
    type,
    playerId,
    dieId,
    turnNumber: state.turnNumber
  });
}

function canTakeAction(state: GameState): boolean {
  return state.phase === "playing" && state.actionCredits > 0;
}

function withMessage(state: GameState, message: string): GameState {
  state.message = message;
  return state;
}

function resolveAction(
  state: GameState,
  type: LastActionType,
  dieId: string | undefined,
  baseMessage: string,
  previousCompletions: Completion[]
): GameState {
  const player = currentPlayer(state);
  const completions = calculateCompletionKeys(state);
  const previousCompletionKeySet = new Set(previousCompletions.map((completion) => completion.key));
  const newCompletions = completions.filter((completion) => !previousCompletionKeySet.has(completion.key));
  const conflicts = detectConflicts(state);

  state.completedKeys = [...new Set([...state.completedKeys, ...newCompletions.map((completion) => completion.key)])];
  state.actionCredits = Math.max(0, state.actionCredits - 1 + newCompletions.length);
  state.selectedDieIds = [];
  state.lastAction = {
    type,
    playerId: player.id,
    dieId,
    completedKeys: newCompletions.map((completion) => completion.key),
    conflictDieIds: conflicts.flatMap((conflict) => conflict.dieIds)
  };
  state.challengeRolls = undefined;

  if (remainingDiceCount(state, player.id) === 0) {
    state.phase = "won";
    state.winnerId = player.id;
    state.message = `${player.name} placed every die and wins Disuko!`;
    return state;
  }

  const comboMessage =
    newCompletions.length > 0
      ? ` ${player.name} earned ${newCompletions.length} combo action${newCompletions.length === 1 ? "" : "s"}.`
      : "";
  const conflictMessage = conflicts.length > 0 ? " Conflict is on the board." : "";
  state.message = `${baseMessage}${comboMessage}${conflictMessage}`;

  if (state.actionCredits <= 0) {
    return advanceTurn(state, state.message);
  }

  return state;
}

function resolveInvalidPlacement(state: GameState, dieId: string, playerId: string): GameState {
  return resolveInvalidAction(state, "place", dieId, playerId);
}

function resolveInvalidMove(state: GameState, dieId: string, playerId: string): GameState {
  return resolveInvalidAction(state, "move", dieId, playerId);
}

function resolveInvalidAction(state: GameState, type: "place" | "move", dieId: string, playerId: string): GameState {
  state.actionCredits = Math.max(0, state.actionCredits - 1);
  state.selectedDieIds = [];
  state.challengeRolls = undefined;
  state.lastAction = {
    type,
    playerId,
    dieId,
    completedKeys: [],
    conflictDieIds: []
  };
  state.message = "invalid move";

  if (state.actionCredits <= 0) {
    state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
    state.turnNumber += 1;
    state.actionCredits = 1;
    state.mode = "place";
    state.selectedDieIds = [];
    state.message = "invalid move";
  }

  return state;
}

function advanceTurn(state: GameState, message: string): GameState {
  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
  state.turnNumber += 1;
  state.actionCredits = 1;
  state.mode = "place";
  state.selectedDieIds = [];
  state.message = `${message} ${currentPlayer(state).name} is up.`;
  return state;
}

function resolveLateChallenge(state: GameState, dieIds: string[]): GameState {
  const involvedDice = state.dice.filter((die) => dieIds.includes(die.id));
  const ownerIds = [...new Set(involvedDice.map((die) => die.ownerId))];
  let dieToRemove: Die | undefined;
  const rolls: ChallengeRoll[] = [];

  if (ownerIds.length <= 1) {
    dieToRemove = involvedDice[0];
  } else {
    ownerIds.forEach((playerId) => {
      const rolled = rollDie(state.rngState);
      state.rngState = rolled.state;
      rolls.push({ playerId, value: rolled.value });
    });

    const lowestRoll = [...rolls].sort((a, b) => a.value - b.value || a.playerId.localeCompare(b.playerId))[0];
    dieToRemove = involvedDice.find((die) => die.ownerId === lowestRoll.playerId);
  }

  if (dieToRemove) {
    dieToRemove.row = null;
    dieToRemove.col = null;
  }

  state.phase = "playing";
  state.winnerId = undefined;
  state.challengeRolls = rolls;
  state.selectedDieIds = [];
  state.mode = "place";
  state.lastAction = {
    type: "challenge",
    playerId: currentPlayer(state).id,
    dieId: dieToRemove?.id,
    completedKeys: [],
    conflictDieIds: dieIds
  };

  const removedOwner = state.players.find((player) => player.id === dieToRemove?.ownerId);
  state.message =
    rolls.length > 0
      ? `Late challenge roll resolved. ${removedOwner?.name ?? "A player"} returned one conflicting die.`
      : `${removedOwner?.name ?? "A player"} returned one conflicting die.`;

  return state;
}

function pushUnitConflicts(
  conflicts: Conflict[],
  kind: "row" | "column" | "box",
  index: number,
  dice: Die[]
): void {
  DICE_VALUES.forEach((value) => {
    const matching = dice.filter((die) => die.value === value);

    if (matching.length > 1) {
      conflicts.push({
        id: `${kind}:${index}:${value}`,
        kind,
        index,
        value,
        dieIds: matching.map((die) => die.id),
        cellKeys: matching.map((die) => cellKey(die.row as number, die.col as number))
      });
    }
  });
}

function range(length: number): number[] {
  return Array.from({ length }, (_, index) => index);
}

function capitalize(value: string): string {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

export { boxIndex, cellKey };
