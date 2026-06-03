import { describe, expect, it } from "vitest";
import { groupDiceByValue, orderTrayDice } from "./diceOrdering";
import type { DiceValue, Die } from "./types";

describe("tray dice ordering", () => {
  it("orders dice in ascending value passes from 1 to 6", () => {
    const dice = makeDice([5, 1, 3, 6, 2, 4]);

    expect(orderTrayDice(dice).map((die) => die.value)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("interleaves duplicate values into later passes", () => {
    const dice = makeDice([3, 1, 2, 1, 3, 2, 6, 6]);

    expect(orderTrayDice(dice).map((die) => die.value)).toEqual([1, 2, 3, 6, 1, 2, 3, 6]);
  });

  it("keeps same-value dice apart whenever another value is available", () => {
    const dice = makeDice([1, 1, 1, 2, 2, 3]);
    const orderedValues = orderTrayDice(dice).map((die) => die.value);

    expect(orderedValues).toEqual([1, 2, 3, 1, 2, 1]);
    expect(hasAvoidableAdjacentDuplicate(orderedValues)).toBe(false);
  });

  it("groups dice by ascending value and omits missing values", () => {
    const groups = groupDiceByValue(makeDice([6, 2, 2, 4, 6]));

    expect(groups.map((group) => group.value)).toEqual([2, 4, 6]);
    expect(groups.map((group) => group.count)).toEqual([2, 1, 2]);
  });

  it("keeps the first die of a value as the representative die", () => {
    const dice = makeDice([3, 1, 3, 3]);
    const group = groupDiceByValue(dice).find((diceGroup) => diceGroup.value === 3);

    expect(group?.representativeDie.id).toBe("d0");
    expect(group?.dice.map((die) => die.id)).toEqual(["d0", "d2", "d3"]);
  });
});

function makeDice(values: DiceValue[]): Die[] {
  return values.map((value, index) => ({
    id: `d${index}`,
    ownerId: "p1",
    value,
    row: null,
    col: null
  }));
}

function hasAvoidableAdjacentDuplicate(values: DiceValue[]): boolean {
  return values.some((value, index) => {
    if (index === 0 || values[index - 1] !== value) {
      return false;
    }

    return values.slice(index + 1).some((nextValue) => nextValue !== value);
  });
}
