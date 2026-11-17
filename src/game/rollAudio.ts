import type { RerollImpactEvent, RerollTumbleTrack } from "./rerollTumbles";
import { REROLL_SAMPLE_COMPONENTS } from "./rerollTumbles";

/** Contact force includes a resting die's weight. Only moving contacts make a sound. */
export function isAudibleRollImpact(track: RerollTumbleTrack, impact: RerollImpactEvent, frameRate: number): boolean {
  if (impact.timeMs > track.settleTimeMs + 30) return false;
  const eventIndex = track.impacts.indexOf(impact);
  for (let i = eventIndex - 1; i >= 0; i--) {
    const previous = track.impacts[i];
    if (impact.timeMs - previous.timeMs >= 90) break;
    if (previous.kind === impact.kind) {
      if (impact.strength < previous.strength + 0.09) return false;
      break;
    }
  }
  const last = track.samples.length / REROLL_SAMPLE_COMPONENTS - 1;
  const frame = Math.min(last, Math.round(impact.timeMs / 1000 * frameRate));
  const from = Math.max(0, frame - 2) * REROLL_SAMPLE_COMPONENTS;
  const to = frame * REROLL_SAMPLE_COMPONENTS;
  const samples = track.samples;
  const movement = Math.hypot(samples[to] - samples[from], samples[to + 1] - samples[from + 1], samples[to + 2] - samples[from + 2]);
  let dot = 0;
  for (let axis = 3; axis < 7; axis++) dot += samples[from + axis] * samples[to + axis];
  const rotation = 2 * Math.acos(Math.min(1, Math.abs(dot)));
  return movement > 0.008 || rotation > 0.012;
}
