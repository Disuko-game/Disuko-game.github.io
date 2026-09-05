import { Quaternion, Vector3 } from "three";
import { DICE_VALUES, type DiceValue } from "./game/types";

const FACE_NORMALS: Record<DiceValue, Vector3> = {
  1: new Vector3(0, 1, 0),
  2: new Vector3(0, 0, 1),
  3: new Vector3(1, 0, 0),
  4: new Vector3(-1, 0, 0),
  5: new Vector3(0, 0, -1),
  6: new Vector3(0, -1, 0)
};

/**
 * Relabel a physical tumble without changing its cube silhouette or contacts.
 * Apply the returned, fixed local rotation as physicsQuaternion * correction.
 * A tilted/stacked endpoint keeps its tilt; the requested face becomes the
 * most upward face instead of forcing the rendered die flat through the floor.
 */
export function cubeSymmetryCorrection(baseEnd: Quaternion, desiredValue: DiceValue): Quaternion {
  const settled = baseEnd.clone().normalize();
  const desiredNormal = FACE_NORMALS[desiredValue];
  const worldNormal = new Vector3();
  let upwardNormal = desiredNormal;
  let bestUp = -Infinity;
  let bestSimilarity = -Infinity;

  for (const value of DICE_VALUES) {
    const normal = FACE_NORMALS[value];
    const up = worldNormal.copy(normal).applyQuaternion(settled).y;
    const similarity = desiredNormal.dot(normal);
    if (up > bestUp + 1e-10 || (Math.abs(up - bestUp) <= 1e-10 && similarity > bestSimilarity)) {
      upwardNormal = normal;
      bestUp = up;
      bestSimilarity = similarity;
    }
  }

  // Both normals are cardinal axes. Their shortest rotation is 0, 90 or 180
  // degrees about a cardinal axis, hence one of the cube's 24 symmetries.
  return new Quaternion().setFromUnitVectors(desiredNormal, upwardNormal);
}
