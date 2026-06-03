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
  recentBoardChangesForCurrentTurn,
  remainingDiceCount,
  rerollDice,
  restoreGame,
  selectDie,
  setSelectedRerollDice,
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

  it("stacks combo actions when one placement completes a row and column", () => {
    const game = newGame({ playerCount: 2, seed: "stacked-place-combo" });
    const blueDice = game.dice.filter((die) => die.ownerId === "p1");

    blueDice.slice(0, 5).forEach((die, index) => {
      die.value = ((index % 5) + 1) as typeof die.value;
      die.row = 0;
      die.col = index;
    });
    blueDice.slice(5, 10).forEach((die, index) => {
      die.value = ((index % 5) + 1) as typeof die.value;
      die.row = index + 1;
      die.col = 5;
    });
    blueDice[10].value = 6;
    game.completedKeys = calculateCompletionKeys(game).map((completion) => completion.key);

    const next = placeDie(game, blueDice[10].id, 0, 5);

    expect(next.currentPlayerIndex).toBe(0);
    expect(next.actionCredits).toBe(2);
    expect(next.lastAction?.completedKeys).toEqual(["row:0", "column:5"]);
    expect(next.completedKeys).toContain("row:0");
    expect(next.completedKeys).toContain("column:5");
  });

  it("stacks combo actions when one placement completes a row, column, and box", () => {
    const game = newGame({ playerCount: 2, seed: "triple-place-combo" });
    const blueDice = game.dice.filter((die) => die.ownerId === "p1");
    const setupCells = [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
      { row: 2, col: 0 },
      { row: 2, col: 2 },
      { row: 2, col: 3 },
      { row: 2, col: 4 },
      { row: 2, col: 5 },
      { row: 3, col: 1 },
      { row: 4, col: 1 },
      { row: 5, col: 1 }
    ];

    setupCells.forEach((cell, index) => {
      blueDice[index].value = ((index % 6) + 1) as (typeof blueDice)[number]["value"];
      blueDice[index].row = cell.row;
      blueDice[index].col = cell.col;
    });
    blueDice[12].value = 6;

    const next = placeDie(game, blueDice[12].id, 2, 1);

    expect(next.currentPlayerIndex).toBe(0);
    expect(next.actionCredits).toBe(3);
    expect(next.lastAction?.completedKeys).toEqual(["row:2", "column:1", "box:0"]);
  });

  it("awards a combo when a previously awarded row is completed again from incomplete", () => {
    const game = newGame({ playerCount: 2, seed: "repeat-row-combo" });
    const blueDice = game.dice.filter((die) => die.ownerId === "p1");

    blueDice.slice(0, 5).forEach((die, index) => {
      die.row = 0;
      die.col = index;
    });
    blueDice[5].row = 1;
    blueDice[5].col = 0;
    game.completedKeys = ["row:0"];

    const next = moveDie(game, blueDice[5].id, 0, 5);

    expect(next.currentPlayerIndex).toBe(0);
    expect(next.actionCredits).toBe(1);
    expect(next.lastAction?.completedKeys).toEqual(["row:0"]);
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

  it("selects and moves another player's board die", () => {
    const game = newGame({ playerCount: 2, seed: "move-opponent" });
    const redDie = game.dice.find((candidate) => candidate.ownerId === "p2")!;
    redDie.row = 0;
    redDie.col = 0;

    const selected = selectDie(game, redDie.id);
    const moved = moveDie(selected, redDie.id, 1, 1);
    const movedDie = moved.dice.find((candidate) => candidate.id === redDie.id);

    expect(selected.selectedDieIds).toEqual([redDie.id]);
    expect(movedDie?.row).toBe(1);
    expect(movedDie?.col).toBe(1);
    expect(moved.currentPlayerIndex).toBe(1);
  });

  it("tracks board changes visible since the active player's previous turn", () => {
    const game = newGame({ playerCount: 2, seed: "recent-changes" });
    const blueDie = game.dice.find((candidate) => candidate.ownerId === "p1")!;

    const afterBluePlace = placeDie(game, blueDie.id, 0, 0);
    const visibleForRed = recentBoardChangesForCurrentTurn(afterBluePlace);

    expect(visibleForRed).toEqual([
      {
        type: "place",
        playerId: "p1",
        dieId: blueDie.id,
        turnNumber: 1
      }
    ]);

    const afterRedMove = moveDie(afterBluePlace, blueDie.id, 2, 2);
    const visibleForBlue = recentBoardChangesForCurrentTurn(afterRedMove);

    expect(visibleForBlue).toEqual([
      {
        type: "move",
        playerId: "p2",
        dieId: blueDie.id,
        turnNumber: 2
      }
    ]);
  });

  it("awards the current player a combo action when moving another player's die completes a row", () => {
    const game = newGame({ playerCount: 2, seed: "opponent-row-combo" });
    const blueDice = game.dice.filter((die) => die.ownerId === "p1");
    const redDie = game.dice.find((die) => die.ownerId === "p2")!;

    blueDice.slice(0, 5).forEach((die, index) => {
      die.value = (index + 1) as typeof die.value;
      die.row = 0;
      die.col = index;
    });
    redDie.value = 6;
    redDie.row = 1;
    redDie.col = 5;

    const next = moveDie(game, redDie.id, 0, 5);

    expect(next.currentPlayerIndex).toBe(0);
    expect(next.actionCredits).toBe(1);
    expect(next.completedKeys).toContain("row:0");
    expect(next.lastAction?.playerId).toBe("p1");
  });

  it("awards the current player a combo action when moving another player's die completes a column", () => {
    const game = newGame({ playerCount: 2, seed: "opponent-column-combo" });
    const blueDice = game.dice.filter((die) => die.ownerId === "p1");
    const redDie = game.dice.find((die) => die.ownerId === "p2")!;

    blueDice.slice(0, 5).forEach((die, index) => {
      die.value = (index + 1) as typeof die.value;
      die.row = index;
      die.col = 0;
    });
    redDie.value = 6;
    redDie.row = 5;
    redDie.col = 1;

    const next = moveDie(game, redDie.id, 5, 0);

    expect(next.currentPlayerIndex).toBe(0);
    expect(next.actionCredits).toBe(1);
    expect(next.completedKeys).toContain("column:0");
    expect(next.lastAction?.playerId).toBe("p1");
  });

  it("stacks combo actions when moving another player's die completes a row and column", () => {
    const game = newGame({ playerCount: 2, seed: "stacked-move-combo" });
    const blueDice = game.dice.filter((die) => die.ownerId === "p1");
    const redDie = game.dice.find((die) => die.ownerId === "p2")!;

    blueDice.slice(0, 5).forEach((die, index) => {
      die.value = ((index % 5) + 1) as typeof die.value;
      die.row = 0;
      die.col = index;
    });
    blueDice.slice(5, 10).forEach((die, index) => {
      die.value = ((index % 5) + 1) as typeof die.value;
      die.row = index + 1;
      die.col = 5;
    });
    redDie.value = 6;
    redDie.row = 5;
    redDie.col = 4;
    game.completedKeys = calculateCompletionKeys(game).map((completion) => completion.key);

    const next = moveDie(game, redDie.id, 0, 5);

    expect(next.currentPlayerIndex).toBe(0);
    expect(next.actionCredits).toBe(2);
    expect(next.lastAction?.playerId).toBe("p1");
    expect(next.lastAction?.dieId).toBe(redDie.id);
    expect(next.lastAction?.completedKeys).toEqual(["row:0", "column:5"]);
    expect(next.completedKeys).toContain("row:0");
    expect(next.completedKeys).toContain("column:5");
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

  it("sets exact reroll selections for current-player off-board dice", () => {
    const game = newGame({ playerCount: 2, seed: "reroll-selection" });
    const blueDice = game.dice.filter((die) => die.ownerId === "p1");
    const redDie = game.dice.find((die) => die.ownerId === "p2")!;
    blueDice[2].row = 0;
    blueDice[2].col = 0;

    const selected = setSelectedRerollDice(game, [blueDice[0].id, blueDice[1].id, blueDice[2].id, redDie.id]);
    expect(selected.mode).toBe("reroll");
    expect(selected.selectedDieIds).toEqual([blueDice[0].id, blueDice[1].id]);

    const cleared = setSelectedRerollDice(selected, []);
    expect(cleared.selectedDieIds).toEqual([]);
  });

  it("rerolls only an explicit partial stack selection", () => {
    const game = newGame({ playerCount: 2, seed: "partial-reroll" });
    game.rngState = 12345;
    const blueDice = game.dice.filter((die) => die.ownerId === "p1");
    blueDice.slice(0, 3).forEach((die) => {
      die.value = 1;
    });

    const selected = setSelectedRerollDice(game, [blueDice[0].id, blueDice[1].id]);
    const next = rerollDice(selected, selected.selectedDieIds, { defaultToAll: false });
    const rerolled = next.dice.filter((die) => [blueDice[0].id, blueDice[1].id].includes(die.id));
    const unselected = next.dice.find((die) => die.id === blueDice[2].id);

    expect(rerolled.map((die) => die.value)).toEqual([6, 2]);
    expect(unselected?.value).toBe(1);
    expect(next.message).toContain("rerolled 2 dice");
  });

  it("does not reroll all dice after an explicit zero reroll selection", () => {
    const game = newGame({ playerCount: 2, seed: "zero-reroll" });
    const blueDice = game.dice.filter((die) => die.ownerId === "p1");
    const originalValues = blueDice.map((die) => die.value);

    const next = rerollDice(setSelectedRerollDice(game, []), [], { defaultToAll: false });

    expect(next.dice.filter((die) => die.ownerId === "p1").map((die) => die.value)).toEqual(originalValues);
    expect(next.currentPlayerIndex).toBe(0);
    expect(next.actionCredits).toBe(1);
    expect(next.message).toBe("Choose dice to reroll.");
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

  it("resolves an immediate challenge from either clicked conflicting die", () => {
    const clickOlderDieGame = newGame({ playerCount: 2, seed: "click-challenge-older" });
    const olderClickDice = clickOlderDieGame.dice.filter((die) => die.ownerId === "p1");
    olderClickDice[0].value = 3;
    olderClickDice[0].row = 0;
    olderClickDice[0].col = 0;
    olderClickDice[1].value = 3;

    const olderClickPlaced = placeDie(clickOlderDieGame, olderClickDice[1].id, 0, 1);
    const olderClickChallenged = challengeViolation(olderClickPlaced, olderClickDice[0].id);

    expect(olderClickChallenged.dice.find((die) => die.id === olderClickDice[1].id)?.row).toBeNull();

    const clickNewerDieGame = newGame({ playerCount: 2, seed: "click-challenge-newer" });
    const newerClickDice = clickNewerDieGame.dice.filter((die) => die.ownerId === "p1");
    newerClickDice[0].value = 3;
    newerClickDice[0].row = 0;
    newerClickDice[0].col = 0;
    newerClickDice[1].value = 3;

    const newerClickPlaced = placeDie(clickNewerDieGame, newerClickDice[1].id, 0, 1);
    const newerClickChallenged = challengeViolation(newerClickPlaced, newerClickDice[1].id);

    expect(newerClickChallenged.dice.find((die) => die.id === newerClickDice[1].id)?.row).toBeNull();
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
