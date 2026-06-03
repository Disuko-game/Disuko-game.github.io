import type { DiceValue } from "./types";

export function seedToState(seed: string): number {
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) || 1;
}

export function nextRandom(state: number): { state: number; value: number } {
  let nextState = (state + 0x6d2b79f5) >>> 0;
  let mixed = nextState;

  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);

  return {
    state: nextState,
    value: ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  };
}

export function rollDie(state: number): { state: number; value: DiceValue } {
  const next = nextRandom(state);

  return {
    state: next.state,
    value: (Math.floor(next.value * 6) + 1) as DiceValue
  };
}
