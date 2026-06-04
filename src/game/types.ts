export const BOARD_SIZE = 6;
export const BOX_WIDTH = 2;
export const BOX_HEIGHT = 3;
export const BOX_COUNT = 6;

export const PLAYER_COLORS = ["blue", "red", "green", "yellow"] as const;
export const DICE_VALUES = [1, 2, 3, 4, 5, 6] as const;

export type PlayerColor = (typeof PLAYER_COLORS)[number];
export type DiceValue = (typeof DICE_VALUES)[number];
export type ActionMode = "place" | "move" | "reroll" | "challenge";
export type GamePhase = "playing" | "won";
export type CompletionKind = "row" | "column" | "box" | "value";
export type ConflictKind = "row" | "column" | "box";
export type LastActionType = "place" | "move" | "reroll" | "challenge" | "pass";
export type BoardChangeType = "place" | "move";

export interface Player {
  id: string;
  name: string;
  color: PlayerColor;
}

export interface Die {
  id: string;
  ownerId: string;
  value: DiceValue;
  row: number | null;
  col: number | null;
}

export interface Conflict {
  id: string;
  kind: ConflictKind;
  index: number;
  value: DiceValue;
  dieIds: string[];
  cellKeys: string[];
}

export interface Completion {
  key: string;
  kind: CompletionKind;
  index: number;
}

export interface ChallengeRoll {
  playerId: string;
  value: DiceValue;
}

export interface LastAction {
  type: LastActionType;
  playerId: string;
  dieId?: string;
  completedKeys: string[];
  conflictDieIds: string[];
}

export interface BoardChange {
  type: BoardChangeType;
  playerId: string;
  dieId: string;
  turnNumber: number;
}

export interface GameState {
  version: 1;
  seed: string;
  rngState: number;
  players: Player[];
  dice: Die[];
  tabletopMode: boolean;
  currentPlayerIndex: number;
  turnNumber: number;
  actionCredits: number;
  mode: ActionMode;
  selectedDieIds: string[];
  completedKeys: string[];
  phase: GamePhase;
  winnerId?: string;
  message: string;
  lastAction?: LastAction;
  boardChanges: BoardChange[];
  challengeRolls?: ChallengeRoll[];
}

export interface NewGameOptions {
  playerCount: 2 | 3 | 4;
  seed?: string;
  tabletopMode?: boolean;
}
