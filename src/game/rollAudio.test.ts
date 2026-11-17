import { describe, expect, it } from "vitest";
import { isAudibleRollImpact } from "./rollAudio";
import type { RerollImpactEvent, RerollTumbleTrack } from "./rerollTumbles";

function track(moving: boolean): RerollTumbleTrack {
  const samples = new Float32Array(61 * 7);
  for (let frame = 0; frame <= 60; frame++) {
    samples[frame * 7] = moving ? frame * 0.02 : 0;
    samples[frame * 7 + 6] = 1;
  }
  return { samples, settleTimeMs: 900, impacts: [] };
}
const hit = (timeMs: number, strength = 0.8): RerollImpactEvent => ({ timeMs, strength, kind: "floor" });

describe("physical roll audio contacts", () => {
  it("ignores high contact force on a stationary die", () => {
    const t = track(false), event = hit(500, 1);
    t.impacts = [event];
    expect(isAudibleRollImpact(t, event, 60)).toBe(false);
  });
  it("keeps a real moving impact and stops reports after settling", () => {
    const t = track(true), event = hit(500), stale = hit(980, 1);
    t.impacts = [event, stale];
    expect(isAudibleRollImpact(t, event, 60)).toBe(true);
    expect(isAudibleRollImpact(t, stale, 60)).toBe(false);
  });
  it("ignores sustained contact while keeping a new force attack and a later bounce", () => {
    const t = track(true);
    t.impacts = [hit(400, 0.7), hit(450, 0.68), hit(500, 0.95), hit(650, 0.5)];
    expect(t.impacts.map((event) => isAudibleRollImpact(t, event, 60))).toEqual([true, false, true, true]);
  });
  it("keeps a rotating die's edge contacts even without translation", () => {
    const t = track(false), event = hit(500);
    t.samples[30 * 7 + 5] = Math.sin(0.08);
    t.samples[30 * 7 + 6] = Math.cos(0.08);
    t.impacts = [event];
    expect(isAudibleRollImpact(t, event, 60)).toBe(true);
  });
});
