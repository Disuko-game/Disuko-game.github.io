import { describe, expect, it } from "vitest";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { DICE_VALUES, type DiceValue } from "./game/types";
import { cubeSymmetryCorrection } from "./diceOrientation";

const FACE_NORMALS: Record<DiceValue, Vector3> = {
  1: new Vector3(0, 1, 0),
  2: new Vector3(0, 0, 1),
  3: new Vector3(1, 0, 0),
  4: new Vector3(-1, 0, 0),
  5: new Vector3(0, 0, -1),
  6: new Vector3(0, -1, 0)
};
const AXES = Object.values(FACE_NORMALS);
const CORNERS = [-0.52, 0.52].flatMap(x =>
  [-0.52, 0.52].flatMap(y => [-0.52, 0.52].map(z => new Vector3(x, y, z)))
);

function allCubeOrientations(): Quaternion[] {
  return AXES.flatMap(x => AXES.filter(y => x.dot(y) === 0).map(y =>
    new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, new Vector3().crossVectors(x, y)))
  ));
}

function expectCubeSymmetry(rotation: Quaternion) {
  for (const axis of AXES) {
    const transformed = axis.clone().applyQuaternion(rotation);
    expect(AXES.some(candidate => candidate.distanceTo(transformed) < 1e-10)).toBe(true);
  }
  const transformedX = new Vector3(1, 0, 0).applyQuaternion(rotation);
  const transformedY = new Vector3(0, 1, 0).applyQuaternion(rotation);
  const transformedZ = new Vector3(0, 0, 1).applyQuaternion(rotation);
  expect(transformedX.cross(transformedY).dot(transformedZ)).toBeCloseTo(1, 10);
}

describe("physical die result orientation", () => {
  it("puts every requested face exactly up for all 24 flat cube orientations", () => {
    const orientations = allCubeOrientations();
    expect(orientations).toHaveLength(24);
    for (const [index, baseEnd] of orientations.entries()) {
      expect(orientations.slice(0, index).some(other => Math.abs(other.dot(baseEnd)) > 1 - 1e-10)).toBe(false);
      for (const value of DICE_VALUES) {
        const correction = cubeSymmetryCorrection(baseEnd, value);
        expectCubeSymmetry(correction);
        const displayed = baseEnd.clone().multiply(correction);
        const requestedNormal = FACE_NORMALS[value].clone().applyQuaternion(displayed);
        expect(requestedNormal.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-10);
      }
    }
  });

  it("keeps tilted and stacked endpoints tilted while assigning their most upward face", () => {
    const endpoints = [
      new Quaternion().setFromEuler(new Euler(0.21, 1.1, -0.18)),
      new Quaternion().setFromEuler(new Euler(1.08, -0.74, 0.63)),
      new Quaternion(0.3, 0.5, 0.1, 0.7).normalize(),
      new Quaternion().setFromEuler(new Euler(0.48, 0.25, Math.PI))
    ];
    for (const baseEnd of endpoints) {
      const mostUp = Math.max(...AXES.map(axis => axis.clone().applyQuaternion(baseEnd).y));
      expect(mostUp).toBeLessThan(0.999);
      for (const value of DICE_VALUES) {
        const correction = cubeSymmetryCorrection(baseEnd, value);
        expectCubeSymmetry(correction);
        const displayed = baseEnd.clone().multiply(correction);
        const requestedUp = FACE_NORMALS[value].clone().applyQuaternion(displayed).y;
        expect(requestedUp).toBeCloseTo(mostUp, 10);
        for (const normal of AXES) {
          expect(normal.clone().applyQuaternion(displayed).y).toBeLessThanOrEqual(requestedUp + 1e-10);
        }
      }
    }
  });

  it("preserves the physical cube's vertices throughout the tumble, not just at its endpoint", () => {
    const motionFrames = [
      new Quaternion().setFromEuler(new Euler(0.37, -1.24, 0.82)),
      new Quaternion().setFromEuler(new Euler(2.3, 4.7, -3.6)),
      new Quaternion().setFromEuler(new Euler(-0.11, 0.63, 1.4))
    ];
    for (const baseEnd of allCubeOrientations()) {
      for (const value of DICE_VALUES) {
        const correction = cubeSymmetryCorrection(baseEnd, value);
        for (const physical of motionFrames) {
          const physicalVertices = CORNERS.map(corner => corner.clone().applyQuaternion(physical));
          const displayed = physical.clone().multiply(correction);
          for (const corner of CORNERS) {
            const vertex = corner.clone().applyQuaternion(displayed);
            expect(physicalVertices.some(candidate => candidate.distanceTo(vertex) < 1e-10)).toBe(true);
          }
        }
      }
    }
  });

  it("leaves already upward faces alone, including an exact edge-balanced tie", () => {
    const identity = new Quaternion();
    expect(cubeSymmetryCorrection(identity, 1).angleTo(identity)).toBeCloseTo(0, 10);
    const edgeBalanced = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4);
    expect(cubeSymmetryCorrection(edgeBalanced, 1).angleTo(identity)).toBeCloseTo(0, 10);
    expect(cubeSymmetryCorrection(edgeBalanced, 3).angleTo(identity)).toBeCloseTo(0, 10);
  });

  it("does not mutate the supplied physics quaternion", () => {
    const baseEnd = new Quaternion().setFromEuler(new Euler(0.31, -0.52, 1.29));
    const original = baseEnd.clone();
    for (const value of DICE_VALUES) cubeSymmetryCorrection(baseEnd, value);
    expect(baseEnd.toArray()).toEqual(original.toArray());
  });
});
