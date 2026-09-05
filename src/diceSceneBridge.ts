import type { Quaternion, Vector3 } from "three";
import type { PlayerColor } from "./game/types";

/** Physics publishes poses; the gameplay canvas owns all rendering and lighting. */
export interface RollingDiePose {
  id: string;
  color: PlayerColor;
  position: Vector3;
  quaternion: Quaternion;
  scale: Vector3;
}

export interface RollPresentation {
  host: HTMLElement;
  dice: RollingDiePose[];
}

export const liveRolls = new Map<symbol, RollPresentation>();
// A near-overhead tabletop view: show a small front edge, not a tilted showcase pose.
export const TABLE_CAMERA_TILT = 0.26;
export const TABLE_CAMERA_COS = Math.cos(TABLE_CAMERA_TILT);
export const TABLE_CAMERA_SIN = Math.sin(TABLE_CAMERA_TILT);
export const ROLL_VIEW_WIDTH = 10.6;

export function rollScreenPosition(presentation: RollPresentation, position: Vector3) {
  const rect = presentation.host.getBoundingClientRect();
  const boardWidth = document.querySelector(".board-grid")?.getBoundingClientRect().width ?? rect.width;
  const pixelsPerUnit = Math.min(rect.width / ROLL_VIEW_WIDTH, boardWidth / 9.6);
  return {
    x: rect.left + rect.width / 2 + position.x * pixelsPerUnit,
    y: rect.top + rect.height / 2 + (position.z * TABLE_CAMERA_COS - position.y * TABLE_CAMERA_SIN) * pixelsPerUnit,
    pixelsPerUnit
  };
}
