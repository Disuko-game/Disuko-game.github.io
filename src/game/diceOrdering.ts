import { DICE_VALUES, type Die } from "./types";

export interface DiceValueGroup {
  value: Die["value"];
  dice: Die[];
  count: number;
  representativeDie: Die;
}

export function orderTrayDice(dice: Die[]): Die[] {
  const diceByValue = new Map(DICE_VALUES.map((value) => [value, [] as Die[]]));

  dice.forEach((die) => {
    diceByValue.get(die.value)?.push(die);
  });

  const ordered: Die[] = [];
  let hasRemainingDice = true;

  while (hasRemainingDice) {
    hasRemainingDice = false;

    DICE_VALUES.forEach((value) => {
      const bucket = diceByValue.get(value);

      if (!bucket || bucket.length === 0) {
        return;
      }

      hasRemainingDice = true;
      ordered.push(bucket.shift() as Die);
    });
  }

  return ordered;
}

export function groupDiceByValue(dice: Die[]): DiceValueGroup[] {
  const diceByValue = new Map(DICE_VALUES.map((value) => [value, [] as Die[]]));

  dice.forEach((die) => {
    diceByValue.get(die.value)?.push(die);
  });

  return DICE_VALUES.flatMap((value) => {
    const valueDice = diceByValue.get(value) ?? [];
    const representativeDie = valueDice[0];

    if (!representativeDie) {
      return [];
    }

    return [
      {
        value,
        dice: valueDice,
        count: valueDice.length,
        representativeDie
      }
    ];
  });
}
