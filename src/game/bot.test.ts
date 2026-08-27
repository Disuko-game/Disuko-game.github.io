import { describe, expect, it } from "vitest";
import {
  applyBotAction,
  chooseBotAction,
  expectedOpponentRerollValueControlGain,
  isOpeningValueControlState,
  legalBotActions,
  runBotTurn,
  type BotAction
} from "./bot";
import {
  canRerollOpponentDie,
  currentPlayer,
  detectConflicts,
  getDieAt,
  isOnBoard,
  newGame,
  offBoardDice,
  wasDieMovedThisTurn,
  wouldMoveDieConflict,
  wouldPlaceDieConflict
} from "./engine";
import type { BotDifficulty, DiceValue, GameState } from "./types";

const difficulties: BotDifficulty[] = ["very-easy", "easy", "medium", "hard"];
const validBoard: DiceValue[][] = [
  [1, 2, 3, 4, 5, 6],
  [3, 4, 5, 6, 1, 2],
  [5, 6, 1, 2, 3, 4],
  [2, 1, 4, 3, 6, 5],
  [4, 3, 6, 5, 2, 1],
  [6, 5, 2, 1, 4, 3]
];

describe("Disuko bots", () => {
  it("generates valid engine actions without mutating the game", () => {
    const game = newGame({ skipOpeningRoll: true, playerCount: 2, seed: "bot-legality" });
    const blueDice = game.dice.filter((die) => die.ownerId === "p1").slice(0, 3);
    const redDice = game.dice.filter((die) => die.ownerId === "p2").slice(0, 2);

    game.dice = [...blueDice, ...redDice];
    blueDice[0].value = 2;
    blueDice[1].value = 3;
    blueDice[2].value = 5;
    redDice[0].value = 2;
    redDice[0].row = 0;
    redDice[0].col = 0;
    redDice[1].value = 4;
    redDice[1].row = 3;
    redDice[1].col = 3;

    const before = JSON.stringify(game);
    const actions = legalBotActions(game);

    expect(actions.length).toBeGreaterThan(0);
    expect(actions.some((action) => action.type === "move" && action.dieId === redDice[0].id)).toBe(true);

    actions.forEach((action) => assertActionIsLegal(game, action));

    const placement = actions.find((action): action is Extract<BotAction, { type: "place" }> => {
      return action.type === "place";
    });
    const singleReroll = actions.find((action): action is Extract<BotAction, { type: "reroll" }> => {
      return action.type === "reroll" && action.dieIds.length === 1;
    });

    expect(placement).toBeDefined();
    expect(singleReroll).toBeDefined();

    const afterPlacement = applyBotAction(game, placement as Extract<BotAction, { type: "place" }>);
    const afterReroll = applyBotAction(game, singleReroll as Extract<BotAction, { type: "reroll" }>);

    expect(afterPlacement.lastAction?.type).toBe("place");
    expect(afterReroll.lastAction?.type).toBe("reroll");
    expect(JSON.stringify(game)).toBe(before);
  });

  it("offers each eligible opponent die as a single reroll action", () => {
    const game = newGame({
      skipOpeningRoll: true,
      playerCount: 2,
      seed: "bot-opponent-reroll",
      opponentRerollEnabled: true
    });
    const opponentDice = game.dice.filter((die) => die.ownerId === "p2").slice(0, 2);
    game.dice = [
      game.dice.find((die) => die.ownerId === "p1")!,
      ...opponentDice
    ];
    game.actionCredits = 2;

    const actions = legalBotActions(game);
    opponentDice.forEach((die) => {
      expect(actions).toContainEqual({ type: "reroll", dieIds: [die.id] });
    });

    const afterReroll = applyBotAction(game, { type: "reroll", dieIds: [opponentDice[0].id] });
    expect(legalBotActions(afterReroll)).not.toContainEqual({
      type: "reroll",
      dieIds: [opponentDice[0].id]
    });
    expect(legalBotActions(afterReroll)).toContainEqual({
      type: "reroll",
      dieIds: [opponentDice[1].id]
    });
  });

  it("recognizes control starting with one matching die", () => {
    const game = newGame({
      skipOpeningRoll: true,
      playerCount: 2,
      seed: "one-die-value-control",
      opponentRerollEnabled: true
    });
    const ownFive = game.dice.find((die) => die.ownerId === "p1")!;
    const opponentFive = game.dice.find((die) => die.ownerId === "p2")!;
    ownFive.value = 5;
    opponentFive.value = 5;
    game.dice = [ownFive, opponentFive];

    expect(expectedOpponentRerollValueControlGain(
      game,
      { type: "reroll", dieIds: [opponentFive.id] },
      "p1"
    )).toBeGreaterThan(0);
  });

  it("has hard reroll an opponent's final matching value to create a monopoly", () => {
    const game = newGame({
      skipOpeningRoll: true,
      playerCount: 2,
      seed: "hard-value-control",
      opponentRerollEnabled: true
    });
    const ownFives = game.dice.filter((die) => die.ownerId === "p1").slice(0, 4);
    const opponentFive = game.dice.find((die) => die.ownerId === "p2")!;

    ownFives.forEach((die) => { die.value = 5; });
    opponentFive.value = 5;
    game.dice = [...ownFives, opponentFive];

    expect(chooseBotAction(game, "hard")).toEqual({
      type: "reroll",
      dieIds: [opponentFive.id]
    });
    game.turnNumber = game.players.length * 2 + 1;
    expect(isOpeningValueControlState(game)).toBe(false);
  });

  it("chooses a legal deterministic action at every difficulty without peeking at game RNG", () => {
    const game = compactOpenGame("bot-determinism");

    difficulties.forEach((difficulty) => {
      const first = chooseBotAction(game, difficulty);
      const repeated = chooseBotAction(clone(game), difficulty);
      const differentFutureRolls = clone(game);

      differentFutureRolls.rngState = (game.rngState + 987_654_321) >>> 0;

      expect(repeated).toEqual(first);
      expect(chooseBotAction(differentFutureRolls, difficulty)).toEqual(first);
      expect(legalBotActions(game)).toContainEqual(first);
    });
  });

  it("has easy, medium, and hard take a completion that preserves the turn", () => {
    const game = comboGame("bot-completion-choice");
    const completionDie = offBoardDice(game, "p1").find((die) => die.value === 6);

    expect(completionDie).toBeDefined();

    (["easy", "medium", "hard"] as BotDifficulty[]).forEach((difficulty) => {
      expect(chooseBotAction(game, difficulty)).toEqual({
        type: "place",
        dieId: completionDie?.id,
        row: 0,
        col: 5
      });
    });
  });

  it("prioritizes a challenge and delegates its resolution to the engine", () => {
    const game = newGame({ skipOpeningRoll: true, playerCount: 2, seed: "bot-challenge" });
    const blueDie = game.dice.find((die) => die.ownerId === "p1")!;
    const redDie = game.dice.find((die) => die.ownerId === "p2")!;

    game.dice = [blueDie, redDie];
    blueDie.value = 4;
    blueDie.row = 0;
    blueDie.col = 0;
    redDie.value = 4;
    redDie.row = 0;
    redDie.col = 1;
    game.lastAction = {
      type: "move",
      playerId: "p2",
      dieId: redDie.id,
      completedKeys: [],
      conflictDieIds: []
    };

    expect(detectConflicts(game).length).toBeGreaterThan(0);

    difficulties.forEach((difficulty) => {
      expect(chooseBotAction(game, difficulty).type).toBe("challenge");
    });

    const action = chooseBotAction(game, "hard");
    const challenged = applyBotAction(game, action);

    expect(challenged.dice.find((die) => die.id === redDie.id)?.row).toBeNull();
    expect(challenged.lastAction?.type).toBe("challenge");
    expect(game.dice.find((die) => die.id === redDie.id)?.row).toBe(0);
  });

  it("passes when a playing state has no placement, movement, or reroll", () => {
    const game = newGame({ skipOpeningRoll: true, playerCount: 2, seed: "bot-pass" });

    game.dice.forEach((die, index) => {
      const row = Math.floor(index / 6);
      const col = index % 6;
      die.value = validBoard[row][col];
      die.row = row;
      die.col = col;
    });

    expect(detectConflicts(game)).toHaveLength(0);
    expect(legalBotActions(game)).toEqual([{ type: "pass" }]);
    expect(chooseBotAction(game, "hard")).toEqual({ type: "pass" });

    const passed = applyBotAction(game, { type: "pass" });
    expect(passed.currentPlayerIndex).toBe(1);
    expect(passed.turnNumber).toBe(2);
  });

  it("plays through earned combo actions to finish a complete bot turn", () => {
    const game = comboGame("bot-combo-turn");
    const result = runBotTurn(game, { difficulty: "hard", maxActions: 8 });

    expect(result.actions).toHaveLength(2);
    expect(result.actions[0]).toMatchObject({ type: "place", row: 0, col: 5 });
    expect(result.actions[1].type).toBe("place");
    expect(result.state.phase).toBe("won");
    expect(result.state.winnerId).toBe("p1");
    expect(offBoardDice(result.state, "p1")).toHaveLength(0);
    expect(game.phase).toBe("playing");
    expect(offBoardDice(game, "p1")).toHaveLength(2);
  });

  it("has hard move into a spatial completion before refilling a high-value vacancy", () => {
    const game = actionBankGame("hard-action-bank");
    const sourceDie = getDieAt(game, 0, 0);
    const replacementDie = offBoardDice(game, "p1").find((die) => die.value === 1);

    expect(sourceDie?.value).toBe(1);
    expect(replacementDie).toBeDefined();

    const setup = chooseBotAction(game, "hard");

    expect(setup).toEqual({ type: "move", dieId: sourceDie?.id, row: 4, col: 5 });

    const afterSetup = applyBotAction(game, setup);
    expect(afterSetup.lastAction?.completedKeys).toContain("row:4");
    expect(afterSetup.actionCredits).toBe(1);

    const replacement = chooseBotAction(afterSetup, "hard");
    expect(replacement).toEqual({ type: "place", dieId: replacementDie?.id, row: 0, col: 0 });

    const afterReplacement = applyBotAction(afterSetup, replacement);
    expect(afterReplacement.lastAction?.completedKeys).toEqual(
      expect.arrayContaining(["row:0", "column:0", "box:0"])
    );
    expect(afterReplacement.actionCredits).toBe(3);
  });

  it("forces a safe handoff when the bot-turn action guard is reached", () => {
    const game = comboGame("bot-turn-guard");
    const result = runBotTurn(game, { difficulty: "medium", maxActions: 1 });

    expect(result.actions).toHaveLength(2);
    expect(result.actions[0].type).toBe("place");
    expect(result.actions[1]).toEqual({ type: "pass" });
    expect(result.state.phase).toBe("playing");
    expect(currentPlayer(result.state).id).toBe("p2");
  });

  it.each([
    { playerCount: 3 as const, threatenedPlayerId: "p3" as const },
    { playerCount: 4 as const, threatenedPlayerId: "p3" as const },
    { playerCount: 4 as const, threatenedPlayerId: "p4" as const }
  ])(
    "has hard avoid creating a value-set completion for $threatenedPlayerId in a $playerCount-player game",
    ({ playerCount, threatenedPlayerId }) => {
      const game = distantOpponentThreatGame(
        `hard-${playerCount}-player-${threatenedPlayerId}-value-threat`,
        playerCount,
        threatenedPlayerId
      );
      const riskyDieIds = offBoardDice(game, "p1")
        .filter((die) => die.value === 6)
        .map((die) => die.id);

      expect(riskyDieIds).toHaveLength(2);
      expect(offBoardDice(game, "p2").some((die) => die.value === 6)).toBe(false);
      expect(offBoardDice(game, threatenedPlayerId).some((die) => die.value === 6)).toBe(true);

      const action = chooseBotAction(game, "hard");

      expect(action.type !== "place" || !riskyDieIds.includes(action.dieId)).toBe(true);
    }
  );
});

function compactOpenGame(seed: string): GameState {
  const game = newGame({ skipOpeningRoll: true, playerCount: 2, seed });
  const blueDice = game.dice.filter((die) => die.ownerId === "p1").slice(0, 3);
  const redDice = game.dice.filter((die) => die.ownerId === "p2").slice(0, 3);

  game.dice = [...blueDice, ...redDice];
  blueDice[0].value = 1;
  blueDice[1].value = 3;
  blueDice[2].value = 6;
  redDice[0].value = 2;
  redDice[0].row = 0;
  redDice[0].col = 0;
  redDice[1].value = 4;
  redDice[1].row = 1;
  redDice[1].col = 2;
  redDice[2].value = 5;
  redDice[2].row = 3;
  redDice[2].col = 4;

  return game;
}

function comboGame(seed: string): GameState {
  const game = newGame({ skipOpeningRoll: true, playerCount: 2, seed });
  const blueDice = game.dice.filter((die) => die.ownerId === "p1").slice(0, 2);
  const redDice = game.dice.filter((die) => die.ownerId === "p2").slice(0, 5);

  game.dice = [...blueDice, ...redDice];
  blueDice[0].value = 6;
  blueDice[1].value = 1;
  redDice.forEach((die, col) => {
    die.value = (col + 1) as DiceValue;
    die.row = 0;
    die.col = col;
  });

  return game;
}

function actionBankGame(seed: string): GameState {
  const game = newGame({ skipOpeningRoll: true, playerCount: 3, seed });
  const playerOneDice = game.dice.filter((die) => die.ownerId === "p1");
  const trayDice = playerOneDice.slice(0, 2);
  const boardDice = game.dice.filter((die) => !trayDice.includes(die)).slice(0, 17);
  const occupied = new Map<string, DiceValue>();

  for (let col = 0; col < 6; col += 1) occupied.set(`0:${col}`, validBoard[0][col]);
  for (let row = 1; row < 6; row += 1) occupied.set(`${row}:0`, validBoard[row][0]);
  occupied.set("1:1", validBoard[1][1]);
  occupied.set("2:1", validBoard[2][1]);
  for (let col = 1; col < 5; col += 1) occupied.set(`4:${col}`, validBoard[4][col]);

  expect(occupied.size).toBe(17);
  game.dice = [...trayDice, ...boardDice];
  trayDice[0].value = 1;
  trayDice[1].value = 3;
  [...occupied.entries()].forEach(([cell, value], index) => {
    const [row, col] = cell.split(":").map(Number);
    boardDice[index].value = value;
    boardDice[index].row = row;
    boardDice[index].col = col;
  });

  return game;
}

function distantOpponentThreatGame(
  seed: string,
  playerCount: 3 | 4,
  threatenedPlayerId: "p3" | "p4"
): GameState {
  const game = newGame({ skipOpeningRoll: true, playerCount, seed });
  const diceFor = (playerId: string) => game.dice.filter((die) => die.ownerId === playerId);
  const playerOneDice = diceFor("p1").slice(0, 5);
  const playerTwoDice = diceFor("p2").slice(0, 2);
  const threatenedPlayerDice = diceFor(threatenedPlayerId).slice(0, 2);
  const boardOwnerId = playerCount === 3 ? "p2" : threatenedPlayerId === "p3" ? "p4" : "p3";
  const boardOwnerOffset = boardOwnerId === "p2" ? 2 : 1;
  const boardOwnerTray = boardOwnerId === "p2" ? [] : diceFor(boardOwnerId).slice(0, 1);
  const boardDice = diceFor(boardOwnerId).slice(boardOwnerOffset, boardOwnerOffset + 4);

  game.dice = [
    ...playerOneDice,
    ...playerTwoDice,
    ...threatenedPlayerDice,
    ...boardOwnerTray,
    ...boardDice
  ].filter((die, index, dice) => dice.findIndex((candidate) => candidate.id === die.id) === index);
  playerOneDice[0].value = 6;
  playerOneDice[1].value = 6;
  playerOneDice[2].value = 1;
  playerOneDice[3].value = 2;
  playerOneDice[4].value = 3;
  playerTwoDice[0].value = 2;
  playerTwoDice[1].value = 3;
  threatenedPlayerDice[0].value = 6;
  threatenedPlayerDice[1].value = 4;
  if (boardOwnerTray[0]) boardOwnerTray[0].value = 5;

  const valueSetPositions = [
    { row: 0, col: 0 },
    { row: 1, col: 2 },
    { row: 2, col: 4 },
    { row: 3, col: 1 }
  ];
  boardDice.forEach((die, index) => {
    die.value = 6;
    die.row = valueSetPositions[index].row;
    die.col = valueSetPositions[index].col;
  });

  return game;
}

function assertActionIsLegal(state: GameState, action: BotAction): void {
  const player = currentPlayer(state);

  if (action.type === "place") {
    const die = state.dice.find((candidate) => candidate.id === action.dieId);
    expect(die?.ownerId).toBe(player.id);
    expect(die && isOnBoard(die)).toBe(false);
    expect(getDieAt(state, action.row, action.col)).toBeUndefined();
    expect(wouldPlaceDieConflict(state, action.dieId, action.row, action.col)).toBe(false);
    return;
  }

  if (action.type === "move") {
    const die = state.dice.find((candidate) => candidate.id === action.dieId);
    expect(die && isOnBoard(die)).toBe(true);
    expect(wasDieMovedThisTurn(state, action.dieId)).toBe(false);
    expect(getDieAt(state, action.row, action.col)).toBeUndefined();
    expect(wouldMoveDieConflict(state, action.dieId, action.row, action.col)).toBe(false);
    return;
  }

  if (action.type === "reroll") {
    expect(action.dieIds.length).toBeGreaterThan(0);
    const dice = action.dieIds.map((dieId) => state.dice.find((candidate) => candidate.id === dieId)!);
    if (dice.some((die) => die.ownerId !== player.id)) {
      expect(action.dieIds).toHaveLength(1);
      expect(dice[0].ownerId).not.toBe(player.id);
      expect(canRerollOpponentDie(state, dice[0].id)).toBe(true);
    } else {
      dice.forEach((die) => {
        expect(die.ownerId).toBe(player.id);
        expect(isOnBoard(die)).toBe(false);
      });
    }
    return;
  }

  if (action.type === "challenge") {
    expect(detectConflicts(state).some((conflict) => conflict.dieIds.includes(action.targetDieId))).toBe(true);
  }
}

function clone(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}
