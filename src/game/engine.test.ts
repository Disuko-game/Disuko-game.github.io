import { describe, expect, it } from "vitest";
import {
  boardDiceForPlayer,
  calculateCompletionKeys,
  challengeViolation,
  detectConflicts,
  diceCountForPlayerCount,
  endAction,
  moveDie,
  newGame,
  placeDie,
  remainingDiceCount,
  rerollDice,
  restoreGame,
  serializeGame
} from "./engine";
import { boxIndex, cellsForBox } from "./geometry";

describe("Disuko board geometry", () => {
  it("uses six 2-column by 3-row boxes on a 6x6 grid", () => {
    expect(boxIndex(0, 0)).toBe(0);
    expect(boxIndex(2, 1)).toBe(0);
    expect(boxIndex(0, 2)).toBe(1);
    expect(boxIndex(2, 5)).toBe(2);
    expect(boxIndex(3, 0)).toBe(3);
    expect(boxIndex(5, 5)).toBe(5);
    expect(cellsForBox(4)).toHaveLength(6);
  });
});

describe("Disuko rules engine", () => {
  it("assigns the tabletop dice counts by player count", () => {
    expect(diceCountForPlayerCount(2)).toBe(18);
    expect(diceCountForPlayerCount(3)).toBe(12);
    expect(diceCountForPlayerCount(4)).toBe(9);
    expect(newGame({ playerCount: 4, seed: "counts" }).dice).toHaveLength(36);
  });

  it("detects row, column, and 2x3 box conflicts without blocking placement", () => {
    const game = newGame({ playerCount: 2, seed: "conflicts" });
    const [first, second] = game.dice.filter((die) => die.ownerId === "p1");
    first.value = 4;
    first.row = 0;
    first.col = 0;
    second.value = 4;
    second.row = 0;
    second.col = 1;

    const conflicts = detectConflicts(game);

    expect(conflicts.map((conflict) => conflict.id)).toContain("row:0:4");
    expect(conflicts.map((conflict) => conflict.id)).toContain("box:0:4");
  });

  it("awards a combo action when a row is completed", () => {
    const game = newGame({ playerCount: 2, seed: "combo" });
    const blueDice = game.dice.filter((die) => die.ownerId === "p1");

    blueDice.slice(0, 5).forEach((die, index) => {
      die.row = 0;
      die.col = index;
    });
    game.completedKeys = calculateCompletionKeys(game).map((completion) => completion.key);

    const next = placeDie(game, blueDice[5].id, 0, 5);

    expect(next.currentPlayerIndex).toBe(0);
    expect(next.actionCredits).toBe(1);
    expect(next.completedKeys).toContain("row:0");
  });

  it("awards combo actions for columns, boxes, and sixth value copies", () => {
    const columnGame = newGame({ playerCount: 2, seed: "column-combo" });
    const columnDice = columnGame.dice.filter((die) => die.ownerId === "p1");
    columnDice.slice(0, 5).forEach((die, index) => {
      die.row = index;
      die.col = 0;
    });
    columnGame.completedKeys = calculateCompletionKeys(columnGame).map((completion) => completion.key);

    const afterColumn = placeDie(columnGame, columnDice[5].id, 5, 0);
    expect(afterColumn.completedKeys).toContain("column:0");
    expect(afterColumn.actionCredits).toBe(1);

    const boxGame = newGame({ playerCount: 2, seed: "box-combo" });
    const boxDice = boxGame.dice.filter((die) => die.ownerId === "p1");
    cellsForBox(0)
      .slice(0, 5)
      .forEach((cell, index) => {
        boxDice[index].row = cell.row;
        boxDice[index].col = cell.col;
      });
    boxGame.completedKeys = calculateCompletionKeys(boxGame).map((completion) => completion.key);

    const boxFinalCell = cellsForBox(0)[5];
    const afterBox = placeDie(boxGame, boxDice[5].id, boxFinalCell.row, boxFinalCell.col);
    expect(afterBox.completedKeys).toContain("box:0");
    expect(afterBox.actionCredits).toBe(1);

    const valueGame = newGame({ playerCount: 2, seed: "value-combo" });
    const valueDice = valueGame.dice.filter((die) => die.ownerId === "p1");
    const valueCells = [
      { row: 0, col: 0 },
      { row: 0, col: 2 },
      { row: 1, col: 4 },
      { row: 3, col: 1 },
      { row: 4, col: 3 },
      { row: 5, col: 5 }
    ];
    valueDice.slice(0, 5).forEach((die, index) => {
      die.value = 2;
      die.row = valueCells[index].row;
      die.col = valueCells[index].col;
    });
    valueGame.completedKeys = calculateCompletionKeys(valueGame).map((completion) => completion.key);
    valueDice[5].value = 2;

    const afterValue = placeDie(valueGame, valueDice[5].id, valueCells[5].row, valueCells[5].col);
    expect(afterValue.completedKeys).toContain("value:2");
    expect(afterValue.actionCredits).toBe(1);
  });

  it("moves placed dice and passes the turn when no combo action is earned", () => {
    const game = newGame({ playerCount: 2, seed: "move" });
    const die = game.dice.find((candidate) => candidate.ownerId === "p1")!;
    die.row = 0;
    die.col = 0;

    const next = moveDie(game, die.id, 1, 1);
    const movedDie = next.dice.find((candidate) => candidate.id === die.id);

    expect(movedDie?.row).toBe(1);
    expect(movedDie?.col).toBe(1);
    expect(next.currentPlayerIndex).toBe(1);
  });

  it("rerolls selected off-board dice only", () => {
    const game = newGame({ playerCount: 2, seed: "reroll" });
    const [offBoard, onBoard] = game.dice.filter((die) => die.ownerId === "p1");
    offBoard.value = 1;
    onBoard.value = 6;
    onBoard.row = 0;
    onBoard.col = 0;

    const next = rerollDice(game, [offBoard.id, onBoard.id]);
    const rerolled = next.dice.find((die) => die.id === offBoard.id);
    const ignored = next.dice.find((die) => die.id === onBoard.id);

    expect(rerolled?.value).not.toBe(1);
    expect(ignored?.value).toBe(6);
    expect(next.currentPlayerIndex).toBe(1);
  });

  it("returns an immediately challenged conflicting die", () => {
    const game = newGame({ playerCount: 2, seed: "challenge" });
    const blueDice = game.dice.filter((die) => die.ownerId === "p1");

    blueDice[0].value = 3;
    blueDice[0].row = 0;
    blueDice[0].col = 0;
    blueDice[1].value = 3;

    const placed = placeDie(game, blueDice[1].id, 0, 1);
    const challenged = challengeViolation(placed);
    const returned = challenged.dice.find((die) => die.id === blueDice[1].id);

    expect(returned?.row).toBeNull();
    expect(returned?.col).toBeNull();
    expect(challenged.currentPlayerIndex).toBe(1);
  });

  it("resolves late challenges by returning one conflicting die", () => {
    const game = newGame({ playerCount: 2, seed: "late-challenge" });
    const blueDie = game.dice.find((die) => die.ownerId === "p1")!;
    const redDie = game.dice.find((die) => die.ownerId === "p2")!;
    blueDie.value = 5;
    blueDie.row = 0;
    blueDie.col = 0;
    redDie.value = 5;
    redDie.row = 0;
    redDie.col = 1;
    game.lastAction = {
      type: "pass",
      playerId: "p1",
      completedKeys: [],
      conflictDieIds: []
    };

    const challenged = challengeViolation(game);
    const returnedDice = challenged.dice.filter((die) => die.id === blueDie.id || die.id === redDie.id);

    expect(returnedDice.filter((die) => die.row === null && die.col === null)).toHaveLength(1);
    expect(challenged.challengeRolls).toHaveLength(2);
  });

  it("supports end-action passes without changing board state", () => {
    const game = newGame({ playerCount: 2, seed: "pass" });
    const next = endAction(game);

    expect(next.currentPlayerIndex).toBe(1);
    expect(next.turnNumber).toBe(2);
    expect(boardDiceForPlayer(next, "p1")).toHaveLength(0);
  });

  it("declares the first player to place all dice as the winner", () => {
    const game = newGame({ playerCount: 4, seed: "win" });
    const blueDice = game.dice.filter((die) => die.ownerId === "p1");
    blueDice.slice(0, 8).forEach((die, index) => {
      die.row = Math.floor(index / 6);
      die.col = index % 6;
    });

    const winner = placeDie(game, blueDice[8].id, 1, 2);

    expect(remainingDiceCount(winner, "p1")).toBe(0);
    expect(winner.phase).toBe("won");
    expect(winner.winnerId).toBe("p1");
  });

  it("serializes and restores save state", () => {
    const game = newGame({ playerCount: 3, seed: "save" });
    const restored = restoreGame(serializeGame(game));

    expect(restored.seed).toBe("save");
    expect(restored.players).toHaveLength(3);
    expect(restored.dice).toHaveLength(36);
  });
});
