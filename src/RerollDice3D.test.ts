import { describe, expect, it } from "vitest";
import { Euler, Quaternion, Vector3 } from "three";
import type { DiceValue } from "./game/types";
import {
  finalDieQuaternion,
  launchRotationForSide,
  orientationCorrection,
  settlingRock
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
  it("keeps resting dice square to the board and each tabletop tray", () => {
    for (let value = 1; value <= 6; value += 1) {
      for (const facing of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const orientation = finalDieQuaternion(value as DiceValue, 0, 0)
          .premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), facing));
        for (const axis of [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]) {
          const direction = axis.applyQuaternion(orientation);
          for (const component of direction.toArray()) {
            expect(component).toBeCloseTo(Math.round(component), 8);
          }
        }
        expect(FACE_NORMAL_BY_VALUE[value as DiceValue].clone().applyQuaternion(orientation).y)
          .toBeCloseTo(1, 8);
      }
    }
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

  it("keeps the requested initial face visible during gathering", () => {
    const baseStart = new Quaternion().setFromEuler(new Euler(1.1, -0.7, 0.45));
    const baseEnd = new Quaternion().setFromEuler(new Euler(7.3, 4.8, -5.2));
    const desiredStart = finalDieQuaternion(1, 2, 3);
    const desiredEnd = finalDieQuaternion(6, 2, 3);
    const displayedStart = baseStart.clone().multiply(orientationCorrection(baseStart, desiredStart));
    const displayedEnd = baseEnd.clone().multiply(orientationCorrection(baseEnd, desiredEnd));

    expect(displayedStart.angleTo(desiredStart)).toBeCloseTo(0, 8);
    expect(displayedEnd.angleTo(desiredEnd)).toBeCloseTo(0, 8);
  });

  it("rocks only after settling and returns exactly to its final orientation", () => {
    const settleTime = 2500;
    expect(settlingRock(settleTime, settleTime, 1, 2)).toEqual({ x: 0, z: 0 });
    const rocking = settlingRock(settleTime + 80, settleTime, 1, 2);
    expect(Math.abs(rocking.x) + Math.abs(rocking.z)).toBeGreaterThan(0);
    expect(settlingRock(settleTime + 300, settleTime, 1, 2)).toEqual({ x: 0, z: 0 });
  });
});
