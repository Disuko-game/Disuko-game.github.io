import { describe, expect, it } from "vitest";
import { Euler, Quaternion, Vector3 } from "three";
import type { DiceValue } from "./game/types";
import { REROLL_GATHER_DURATION_MS } from "./game/rerollTumbles";
import {
  DIE_EDGE_RADIUS,
  DIE_RENDER_SIZE,
  DIE_PIP_RECESS_SCALE,
  DIE_SURFACE_ROUGHNESS,
  finalDieQuaternion,
  impactDeformation,
  launchRotationForSide,
  orientationCorrection,
  settlingRock,
  shadowPresentation
} from "./RerollDice3D";

const FACE_NORMAL_BY_VALUE: Record<DiceValue, Vector3> = {
  1: new Vector3(0, 1, 0),
  2: new Vector3(0, 0, 1),
  3: new Vector3(1, 0, 0),
  4: new Vector3(-1, 0, 0),
  5: new Vector3(0, 0, -1),
  6: new Vector3(0, -1, 0)
};

describe("3D reroll final orientation", () => {
  it("uses rounded glossy-plastic proportions with restrained pip depth", () => {
    expect(DIE_RENDER_SIZE).toBeGreaterThanOrEqual(1);
    expect(DIE_RENDER_SIZE).toBeLessThanOrEqual(1.1);
    expect(DIE_EDGE_RADIUS / DIE_RENDER_SIZE).toBeGreaterThanOrEqual(0.18);
    expect(DIE_EDGE_RADIUS / DIE_RENDER_SIZE).toBeLessThanOrEqual(0.22);
    expect(DIE_SURFACE_ROUGHNESS).toBeGreaterThanOrEqual(0.14);
    expect(DIE_SURFACE_ROUGHNESS).toBeLessThanOrEqual(0.22);
    expect(DIE_PIP_RECESS_SCALE).toBeGreaterThanOrEqual(0.025);
    expect(DIE_PIP_RECESS_SCALE).toBeLessThanOrEqual(0.045);
  });
  it("rotates the bottom-right launch into each player perspective", () => {
    expect(launchRotationForSide("bottom")).toBe(0);
    expect(launchRotationForSide("top")).toBe(Math.PI);
    expect(launchRotationForSide("left")).toBe(-Math.PI / 2);
    expect(launchRotationForSide("right")).toBe(Math.PI / 2);
  });

  it("lands every requested value face-up for every tumble variant", () => {
    for (let value = 1; value <= 6; value += 1) {
      for (let variant = 0; variant < 3; variant += 1) {
        for (let dieIndex = 0; dieIndex < 8; dieIndex += 1) {
          const topNormal = FACE_NORMAL_BY_VALUE[value as DiceValue]
            .clone()
            .applyQuaternion(finalDieQuaternion(value as DiceValue, variant, dieIndex));
          expect(topNormal.x).toBeCloseTo(0, 6);
          expect(topNormal.y).toBeCloseTo(1, 6);
          expect(topNormal.z).toBeCloseTo(0, 6);
        }
      }
    }
  });

  it("retargets the entire tumble orientation without a final face-up correction", () => {
    const baseStart = new Quaternion().setFromEuler(new Euler(1.1, -0.7, 0.45));
    const baseEnd = new Quaternion().setFromEuler(new Euler(7.3, 4.8, -5.2));
    const desiredStart = finalDieQuaternion(1, 2, 3);
    const desiredEnd = finalDieQuaternion(6, 2, 3);
    const displayedStart = baseStart.clone().multiply(orientationCorrection(baseStart, desiredStart));
    const displayedEnd = baseEnd.clone().multiply(orientationCorrection(baseEnd, desiredEnd));

    expect(displayedStart.angleTo(desiredStart)).toBeCloseTo(0, 8);
    expect(displayedEnd.angleTo(desiredEnd)).toBeCloseTo(0, 8);
  });

  it("softens and expands each shadow as its die rises", () => {
    const grounded = shadowPresentation(DIE_RENDER_SIZE / 2 + 0.01);
    const airborne = shadowPresentation(4.7);

    expect(airborne.scaleX).toBeGreaterThan(grounded.scaleX);
    expect(airborne.scaleZ).toBeGreaterThan(grounded.scaleZ);
    expect(airborne.opacity).toBeLessThan(grounded.opacity);
    expect(grounded.scaleX).toBeGreaterThan(0.8);
    expect(grounded.opacity).toBeGreaterThan(0.4);
    expect(grounded.offsetX).toBeLessThan(0);
    expect(grounded.offsetZ).toBeGreaterThan(0);
    expect(Math.abs(airborne.offsetX)).toBeGreaterThan(Math.abs(grounded.offsetX));
    expect(airborne.offsetZ).toBeGreaterThan(grounded.offsetZ);
  });

  it("adds restrained impact compression and returns to the undeformed shape", () => {
    const impact = impactDeformation(0, 1);
    const settled = impactDeformation(220, 1);

    expect(impact.vertical).toBeGreaterThanOrEqual(0.968);
    expect(impact.vertical).toBeLessThan(1);
    expect(impact.horizontal).toBeGreaterThan(1);
    expect(settled).toEqual({ horizontal: 1, vertical: 1 });
  });

  it("rocks only after settling and returns exactly to its final orientation", () => {
    const settleTime = 2500;
    expect(settlingRock(settleTime, settleTime, 1, 2)).toEqual({ x: 0, z: 0 });
    const rocking = settlingRock(settleTime + 80, settleTime, 1, 2);
    expect(Math.abs(rocking.x) + Math.abs(rocking.z)).toBeGreaterThan(0);
    expect(settlingRock(settleTime + 300, settleTime, 1, 2)).toEqual({ x: 0, z: 0 });
  });
});