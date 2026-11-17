import type { RerollImpactKind } from "./game/rerollTumbles";
import { playTableImpact, unlockTableAudio } from "./tableAudio";

export const unlockRerollAudio = unlockTableAudio;
export function playRerollImpact(strength: number, kind: RerollImpactKind, pan: number): void {
  playTableImpact(kind, strength, pan);
}
