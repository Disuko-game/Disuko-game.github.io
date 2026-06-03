import { boxIndex, cellKey, cellsForBox, isInBounds } from "./geometry";
import { rollDie, seedToState } from "./rng";
import {
  BOARD_SIZE,
  BOX_COUNT,
  DICE_VALUES,
  PLAYER_COLORS,
  type ActionMode,
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

const DEFAULT_PLAYER_NAMES = ["You", "Maya", "Jordan", "Ava"];

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
    name: options.playerNames?.[index]?.trim() || DEFAULT_PLAYER_NAMES[index],
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
    currentPlayerIndex: 0,
    turnNumber: 1,
    actionCredits: 1,
    mode: "place",
    selectedDieIds: [],
    completedKeys: [],
    phase: "playing",
    message: `${players[0].name}, place a die, move a die, or reroll your tray.`,
    lastAction: undefined,
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

  if (!die || die.ownerId !== currentPlayer(next).id || next.phase !== "playing") {
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

export function placeDie(state: GameState, dieId: string, row: number, col: number): GameState {
  const next = cloneState(state);
  const player = currentPlayer(next);
  const die = next.dice.find((candidate) => candidate.id === dieId);

  if (!canTakeAction(next)) {
    return withMessage(next, "No action is available. End the action to continue.");
  }

  if (!die || die.ownerId !== player.id || isOnBoard(die)) {
    return withMessage(next, "Select one of your off-board dice to place.");
  }

  if (!isInBounds(row, col) || getDieAt(next, row, col)) {
    return withMessage(next, "Choose an empty board space.");
  }

  die.row = row;
  die.col = col;
  return resolveAction(next, "place", die.id, `${player.name} placed a ${die.value}.`);
}

export function moveDie(state: GameState, dieId: string, row: number, col: number): GameState {
  const next = cloneState(state);
  const player = currentPlayer(next);
  const die = next.dice.find((candidate) => candidate.id === dieId);

  if (!canTakeAction(next)) {
    return withMessage(next, "No action is available. End the action to continue.");
  }

  if (!die || die.ownerId !== player.id || !isOnBoard(die)) {
    return withMessage(next, "Select one of your board dice to move.");
  }

  if (!isInBounds(row, col) || getDieAt(next, row, col)) {
    return withMessage(next, "Move to an empty board space.");
  }

  die.row = row;
  die.col = col;
  return resolveAction(next, "move", die.id, `${player.name} moved a ${die.value}.`);
}

export function rerollDice(state: GameState, dieIds: string[]): GameState {
  const next = cloneState(state);
  const player = currentPlayer(next);
  const requestedIds = dieIds.length > 0 ? dieIds : offBoardDice(next, player.id).map((die) => die.id);
  const diceToRoll = next.dice.filter(
    (die) => requestedIds.includes(die.id) && die.ownerId === player.id && !isOnBoard(die)
  );

  if (!canTakeAction(next)) {
    return withMessage(next, "No action is available. End the action to continue.");
  }

  if (diceToRoll.length === 0) {
    return withMessage(next, "There are no off-board dice selected to reroll.");
  }

  diceToRoll.forEach((die) => {
    const rolled = rollDie(next.rngState);
    next.rngState = rolled.state;
    die.value = rolled.value;
  });

  return resolveAction(next, "reroll", undefined, `${player.name} rerolled ${diceToRoll.length} dice.`);
}

export function challengeViolation(state: GameState): GameState {
  const next = cloneState(state);
  const conflicts = detectConflicts(next);
  const conflictDieIds = new Set(conflicts.flatMap((conflict) => conflict.dieIds));

  if (conflicts.length === 0) {
    return withMessage(next, "No conflicts are on the board right now.");
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
    currentPlayerIndex: parsed.currentPlayerIndex ?? 0,
    turnNumber: parsed.turnNumber ?? 1,
    actionCredits: parsed.actionCredits ?? 1,
    mode: parsed.mode ?? "place",
    selectedDieIds: parsed.selectedDieIds ?? [],
    completedKeys: parsed.completedKeys ?? [],
    phase: parsed.phase ?? "playing",
    message: parsed.message ?? "Game restored."
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
    challengeRolls: state.challengeRolls?.map((roll) => ({ ...roll }))
  };
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
  baseMessage: string
): GameState {
  const player = currentPlayer(state);
  const completions = calculateCompletionKeys(state);
  const completedKeySet = new Set(state.completedKeys);
  const newCompletions = completions.filter((completion) => !completedKeySet.has(completion.key));
  const conflicts = detectConflicts(state);

  state.completedKeys = [...state.completedKeys, ...newCompletions.map((completion) => completion.key)];
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
