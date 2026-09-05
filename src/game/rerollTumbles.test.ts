import { describe, expect, it } from "vitest";
import {
  OPENING_ROLL_TUMBLE_DURATION_MS,
  REROLL_MAX_DICE,
  REROLL_DIE_HALF_SIZE,
  REROLL_SAMPLE_COMPONENTS,
  REROLL_TRAY_HALF_EXTENT,
  REROLL_TUMBLE_DURATION_MS,
  REROLL_TUMBLE_VARIANT_COUNT,
  getOpeningRollTumbleTemplate,
  getRerollTumbleTemplate,
  rerollVariantFromKey
} from "./rerollTumbles";

const TEST_SEEDS = [0, rerollVariantFromKey("game:a:turn:17"), rerollVariantFromKey("game:b:turn:68")];

describe("Rapier reroll tumble templates", () => {
  it("uses a deliberately longer roll window for the full-board throw", () => {
    expect(REROLL_TUMBLE_DURATION_MS).toBeGreaterThanOrEqual(4400);
  });

  it("provides cached seeded throws for every supported dice count", async () => {
    for (let count = 1; count <= REROLL_MAX_DICE; count += 1) {
      for (const variant of TEST_SEEDS) {
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
      for (const variant of TEST_SEEDS) {
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
          let maximumExtent = 0;
          let minimumHeight = Infinity;
          let maximumQuaternionError = 0;
          for (let frame = 0; frame < template.frameCount; frame += 1) {
            const offset = frame * REROLL_SAMPLE_COMPONENTS;
            maximumExtent = Math.max(maximumExtent, Math.abs(track.samples[offset]), Math.abs(track.samples[offset + 2]));
            minimumHeight = Math.min(minimumHeight, track.samples[offset + 1]);

            const quaternionLength = Math.hypot(
              track.samples[offset + 3],
              track.samples[offset + 4],
              track.samples[offset + 5],
              track.samples[offset + 6]
            );
            maximumQuaternionError = Math.max(maximumQuaternionError, Math.abs(quaternionLength - 1));
          }
          expect(maximumExtent).toBeLessThanOrEqual(REROLL_TRAY_HALF_EXTENT + 0.02);
          expect(minimumHeight).toBeGreaterThanOrEqual(REROLL_DIE_HALF_SIZE - 0.1);
          expect(maximumQuaternionError).toBeLessThan(0.00005);
        });

        expect(initialAverageX / count).toBeGreaterThan(2);
        expect(initialAverageZ / count).toBeGreaterThan(2);
        expect(middleAverageX / count).toBeLessThan(initialAverageX / count - 1.2);
        expect(middleAverageZ / count).toBeLessThan(initialAverageZ / count - 1.2);
      }
    }
  }, 20_000);

  it("opens into a broad spray instead of remaining bunched in the launch corner", async () => {
    for (const variant of TEST_SEEDS) {
      const template = await getRerollTumbleTemplate(8, variant);
      const frame = Math.floor(template.frameRate * 1.45);
      const xs = template.tracks.map((track) => track.samples[frame * REROLL_SAMPLE_COMPONENTS]);
      const zs = template.tracks.map((track) => track.samples[frame * REROLL_SAMPLE_COMPONENTS + 2]);
      expect(Math.max(...xs) - Math.min(...xs) + Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(5);
    }
  });

  it("launches from visibly different heights and speeds", async () => {
    const template = await getRerollTumbleTemplate(18, 2);
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
    for (const variant of TEST_SEEDS) {
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
      for (const variant of TEST_SEEDS) {
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

  it("throws opening dice inward from each player's corner with shared collision physics", async () => {
    const template = await getOpeningRollTumbleTemplate([0, 1, 2, 3], 1);
    const initialPositions = template.tracks.map((track) => ({ x: track.samples[0], z: track.samples[2] }));
    const expectedSigns = [
      { x: 1, z: 1 },
      { x: -1, z: -1 },
      { x: 1, z: -1 },
      { x: -1, z: 1 }
    ];

    expect(template.durationMs).toBe(OPENING_ROLL_TUMBLE_DURATION_MS);
    expect(template.tracks).toHaveLength(4);
    initialPositions.forEach((position, index) => {
      expect(Math.sign(position.x)).toBe(expectedSigns[index].x);
      expect(Math.sign(position.z)).toBe(expectedSigns[index].z);
    });

    const middleFrame = Math.floor(template.frameRate * 1.15);
    template.tracks.forEach((track, index) => {
      const offset = middleFrame * REROLL_SAMPLE_COMPONENTS;
      expect(Math.hypot(track.samples[offset], track.samples[offset + 2])).toBeLessThan(
        Math.hypot(initialPositions[index].x, initialPositions[index].z)
      );
    });
    expect(template.tracks.some((track) => track.impacts.some((impact) => impact.kind === "die"))).toBe(true);
  });
  it("chooses variants deterministically without collapsing every roll to one pattern", () => {
    const keys = Array.from({ length: 1024 }, (_, index) => "roll:" + index);
    const variants = keys.map(rerollVariantFromKey);
    expect(keys.map(rerollVariantFromKey)).toEqual(variants);
    expect(new Set(variants).size).toBe(keys.length);
    expect(REROLL_TUMBLE_VARIANT_COUNT).toBe(2 ** 32);
  });

  it("varies the corner release, speed, arc and spin between successive throws", async () => {
    const templates = await Promise.all(Array.from({ length: 12 }, (_, index) => {
      return getRerollTumbleTemplate(1, rerollVariantFromKey(`match:turn:${index}`));
    }));
    const origins = templates.map(({ tracks }) => tracks[0].samples[0]);
    const heights = templates.map(({ tracks }) => tracks[0].samples[1]);
    const launchDistances = templates.map(({ tracks, frameRate }) => {
      const offset = Math.ceil(frameRate * 0.7) * REROLL_SAMPLE_COMPONENTS;
      return Math.hypot(tracks[0].samples[offset] - tracks[0].samples[0], tracks[0].samples[offset + 2] - tracks[0].samples[2]);
    });
    expect(new Set(origins).size).toBe(templates.length);
    expect(Math.max(...origins) - Math.min(...origins)).toBeGreaterThan(0.15);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.15);
    expect(Math.max(...launchDistances) - Math.min(...launchDistances)).toBeGreaterThan(0.4);
    const orientations = templates.map(({ tracks }) => Array.from(tracks[0].samples.slice(7 * 60 + 3, 7 * 60 + 7)).join(","));
    expect(new Set(orientations).size).toBe(templates.length);
  });

  it("evicts old templates and reproduces the exact same trajectories when regenerated", async () => {
    const firstPromise = getRerollTumbleTemplate(4, 921);
    const first = await firstPromise;
    for (let seed = 1000; seed < 1030; seed += 1) await getRerollTumbleTemplate(1, seed);
    const regeneratedPromise = getRerollTumbleTemplate(4, 921);
    expect(regeneratedPromise).not.toBe(firstPromise);
    const regenerated = await regeneratedPromise;
    regenerated.tracks.forEach((track, index) => {
      expect(track.samples).toEqual(first.tracks[index].samples);
      expect(track.settleTimeMs).toBe(first.tracks[index].settleTimeMs);
      expect(track.impacts).toEqual(first.tracks[index].impacts);
    });
  });

  it("avoids overlapping launch bodies and comes to rest before the roll window ends", async () => {
    for (let count = 1; count <= REROLL_MAX_DICE; count += 1) {
      for (const seed of TEST_SEEDS) {
        const template = await getRerollTumbleTemplate(count, seed);
        for (let left = 0; left < count; left += 1) {
          const track = template.tracks[left];
          for (let right = left + 1; right < count; right += 1) {
            const other = template.tracks[right];
            expect(Math.hypot(...[0, 1, 2].map((axis) => track.samples[axis] - other.samples[axis]))).toBeGreaterThan(1.1);
          }
          const last = (template.frameCount - 1) * REROLL_SAMPLE_COMPONENTS;
          const previous = last - 6 * REROLL_SAMPLE_COMPONENTS;
          const finalTravel = Math.hypot(...[0, 1, 2].map((axis) => track.samples[last + axis] - track.samples[previous + axis]));
          expect(finalTravel, `count=${count} seed=${seed} die=${left}`).toBeLessThan(0.025);
          expect(track.settleTimeMs, `count=${count} seed=${seed} die=${left}`).toBeLessThan(REROLL_TUMBLE_DURATION_MS);
        }
      }
    }
  }, 20_000);

  it("keeps broad throw seeds bounded and settled for handfuls and opening rounds", async () => {
    for (let index = 0; index < 20; index += 1) {
      const seed = rerollVariantFromKey(`long-session:${index}`);
      const templates = await Promise.all([
        ...[1, 6, 12, 18].map((count) => getRerollTumbleTemplate(count, seed)),
        getOpeningRollTumbleTemplate([0, 1, 2, 3], seed)
      ]);
      templates.forEach((template) => template.tracks.forEach((track, dieIndex) => {
        let maxExtent = 0;
        let minHeight = Infinity;
        for (let frame = 0; frame < template.frameCount; frame += 1) {
          const offset = frame * REROLL_SAMPLE_COMPONENTS;
          maxExtent = Math.max(maxExtent, Math.abs(track.samples[offset]), Math.abs(track.samples[offset + 2]));
          minHeight = Math.min(minHeight, track.samples[offset + 1]);
        }
        const context = `count=${template.count} seed=${seed} die=${dieIndex}`;
        expect(maxExtent, context).toBeLessThanOrEqual(REROLL_TRAY_HALF_EXTENT + 0.02);
        expect(minHeight, context).toBeGreaterThanOrEqual(REROLL_DIE_HALF_SIZE - 0.1);
        const last = (template.frameCount - 1) * REROLL_SAMPLE_COMPONENTS;
        const previous = last - 6 * REROLL_SAMPLE_COMPONENTS;
        expect(Array.from(track.samples.slice(last, last + 7)), context).toEqual(Array.from(track.samples.slice(previous, previous + 7)));
        expect(track.settleTimeMs, context).toBeLessThan(template.durationMs - 100);
      }));
    }
  }, 20_000);

  it("bounds the opening cache and regenerates opening throws deterministically", async () => {
    const firstPromise = getOpeningRollTumbleTemplate([0, 2], 321);
    const first = await firstPromise;
    expect(getOpeningRollTumbleTemplate([0, 2], 321)).toBe(firstPromise);
    for (let seed = 3000; seed < 3030; seed += 1) await getOpeningRollTumbleTemplate([1], seed);
    const regeneratedPromise = getOpeningRollTumbleTemplate([0, 2], 321);
    expect(regeneratedPromise).not.toBe(firstPromise);
    expect(await regeneratedPromise).toEqual(first);
  });
});
