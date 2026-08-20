import { describe, expect, it } from "vitest";
import {
  REROLL_MAX_DICE,
  REROLL_DIE_HALF_SIZE,
  REROLL_SAMPLE_COMPONENTS,
  REROLL_TRAY_HALF_EXTENT,
  REROLL_TUMBLE_DURATION_MS,
  REROLL_TUMBLE_VARIANT_COUNT,
  getRerollTumbleTemplate,
  rerollVariantFromKey
} from "./rerollTumbles";

describe("Rapier reroll tumble templates", () => {
  it("uses a deliberately longer roll window for the full-board throw", () => {
    expect(REROLL_TUMBLE_DURATION_MS).toBeGreaterThanOrEqual(4400);
  });

  it("provides three cached deterministic templates for every supported dice count", async () => {
    for (let count = 1; count <= REROLL_MAX_DICE; count += 1) {
      for (let variant = 0; variant < REROLL_TUMBLE_VARIANT_COUNT; variant += 1) {
        const promise = getRerollTumbleTemplate(count, variant);
        expect(getRerollTumbleTemplate(count, variant)).toBe(promise);
        const template = await promise;
        expect(template.count).toBe(count);
        expect(template.variant).toBe(variant);
        expect(template.durationMs).toBe(REROLL_TUMBLE_DURATION_MS);
        expect(template.tracks).toHaveLength(count);
      }
    }
  }, 20_000);

  it("throws every group from right to left and keeps every rigid body inside the tray", async () => {
    for (let count = 1; count <= REROLL_MAX_DICE; count += 1) {
      for (let variant = 0; variant < REROLL_TUMBLE_VARIANT_COUNT; variant += 1) {
        const template = await getRerollTumbleTemplate(count, variant);
        const middleFrame = Math.floor(template.frameRate * 1.35);
        let initialAverageX = 0;
        let initialAverageZ = 0;
        let middleAverageX = 0;
        let middleAverageZ = 0;

        template.tracks.forEach((track) => {
          initialAverageX += track.samples[0];
          initialAverageZ += track.samples[2];
          middleAverageX += track.samples[middleFrame * REROLL_SAMPLE_COMPONENTS];
          middleAverageZ += track.samples[middleFrame * REROLL_SAMPLE_COMPONENTS + 2];
          for (let frame = 0; frame < template.frameCount; frame += 1) {
            const offset = frame * REROLL_SAMPLE_COMPONENTS;
            expect(Math.abs(track.samples[offset])).toBeLessThanOrEqual(REROLL_TRAY_HALF_EXTENT + 0.02);
            expect(Math.abs(track.samples[offset + 2])).toBeLessThanOrEqual(REROLL_TRAY_HALF_EXTENT + 0.02);
            expect(track.samples[offset + 1]).toBeGreaterThanOrEqual(REROLL_DIE_HALF_SIZE - 0.1);

            const quaternionLength = Math.hypot(
              track.samples[offset + 3],
              track.samples[offset + 4],
              track.samples[offset + 5],
              track.samples[offset + 6]
            );
            expect(quaternionLength).toBeCloseTo(1, 4);
          }
        });

        expect(initialAverageX / count).toBeGreaterThan(2);
        expect(initialAverageZ / count).toBeGreaterThan(2.25);
        expect(middleAverageX / count).toBeLessThan(initialAverageX / count - 2.6);
        expect(middleAverageZ / count).toBeLessThan(initialAverageZ / count - 1.2);
      }
    }
  }, 20_000);

  it("opens into a broad spray instead of remaining bunched in the launch corner", async () => {
    for (let variant = 0; variant < REROLL_TUMBLE_VARIANT_COUNT; variant += 1) {
      const template = await getRerollTumbleTemplate(8, variant);
      const frame = Math.floor(template.frameRate * 1.45);
      const xs = template.tracks.map((track) => track.samples[frame * REROLL_SAMPLE_COMPONENTS]);
      const zs = template.tracks.map((track) => track.samples[frame * REROLL_SAMPLE_COMPONENTS + 2]);
      expect(Math.max(...xs) - Math.min(...xs) + Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(5);
    }
  });

  it("launches from visibly different heights and speeds", async () => {
    const template = await getRerollTumbleTemplate(8, 2);
    const launchFrame = Math.ceil(template.frameRate * 0.52);
    const laterFrame = Math.ceil(template.frameRate * 0.72);
    const initialHeights = template.tracks.map((track) => track.samples[1]);
    const travelDistances = template.tracks.map((track) => {
      const launchOffset = launchFrame * REROLL_SAMPLE_COMPONENTS;
      const laterOffset = laterFrame * REROLL_SAMPLE_COMPONENTS;
      return Math.hypot(
        track.samples[laterOffset] - track.samples[launchOffset],
        track.samples[laterOffset + 2] - track.samples[launchOffset + 2]
      );
    });
    const peakHeights = template.tracks.map((track) => {
      let peak = 0;
      for (let frame = 0; frame < template.frameCount; frame += 1) {
        peak = Math.max(peak, track.samples[frame * REROLL_SAMPLE_COMPONENTS + 1]);
      }
      return peak;
    });

    expect(Math.max(...initialHeights) - Math.min(...initialHeights)).toBeGreaterThan(0.5);
    expect(Math.max(...travelDistances) - Math.min(...travelDistances)).toBeGreaterThan(1);
    expect(Math.max(...peakHeights)).toBeGreaterThan(2.2);
    expect(Math.max(...peakHeights)).toBeLessThan(3.8);
  });

  it("lets multi-die rolls settle at visibly different times", async () => {
    for (let count = 2; count <= REROLL_MAX_DICE; count += 1) {
      const settleTimes = (await getRerollTumbleTemplate(count, 1)).tracks.map((track) => track.settleTimeMs);
      expect(new Set(settleTimes).size).toBeGreaterThan(1);
      expect(Math.max(...settleTimes) - Math.min(...settleTimes)).toBeGreaterThan(100);
    }
  }, 20_000);

  it("records real floor, wall, and dice contact forces for animation and sound", async () => {
    const kinds = new Set<string>();
    let forceDrivenImpactCount = 0;
    for (let variant = 0; variant < REROLL_TUMBLE_VARIANT_COUNT; variant += 1) {
      const template = await getRerollTumbleTemplate(12, variant);
      template.tracks.forEach((track) => track.impacts.forEach((impact) => {
        kinds.add(impact.kind);
        if (impact.strength > 0.1) forceDrivenImpactCount += 1;
      }));
    }

    expect(kinds).toEqual(new Set(["floor", "wall", "die"]));
    expect(forceDrivenImpactCount).toBeGreaterThan(12);
  }, 20_000);

  it("finishes with non-intersecting 3D bodies while allowing physical stacking", async () => {
    for (let count = 2; count <= REROLL_MAX_DICE; count += 1) {
      for (let variant = 0; variant < REROLL_TUMBLE_VARIANT_COUNT; variant += 1) {
        const template = await getRerollTumbleTemplate(count, variant);
        const finalOffset = (template.frameCount - 1) * REROLL_SAMPLE_COMPONENTS;
        for (let left = 0; left < template.tracks.length; left += 1) {
          for (let right = left + 1; right < template.tracks.length; right += 1) {
            const deltaX = template.tracks[left].samples[finalOffset] - template.tracks[right].samples[finalOffset];
            const deltaY = template.tracks[left].samples[finalOffset + 1]
              - template.tracks[right].samples[finalOffset + 1];
            const deltaZ = template.tracks[left].samples[finalOffset + 2]
              - template.tracks[right].samples[finalOffset + 2];
            expect(Math.hypot(deltaX, deltaY, deltaZ)).toBeGreaterThanOrEqual(0.64);
          }
        }
      }
    }
  }, 20_000);

  it("chooses variants deterministically without collapsing every roll to one pattern", () => {
    const keys = Array.from({ length: 24 }, (_, index) => "roll:" + index);
    const variants = keys.map(rerollVariantFromKey);
    expect(keys.map(rerollVariantFromKey)).toEqual(variants);
    expect(new Set(variants).size).toBe(REROLL_TUMBLE_VARIANT_COUNT);
  });
});


