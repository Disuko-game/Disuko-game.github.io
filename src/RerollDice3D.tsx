import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import * as THREE from "three";
import type { DiceValue, PlayerColor } from "./game/types";
import {
  REROLL_GATHER_DURATION_MS, REROLL_SAMPLE_COMPONENTS,
  getOpeningRollTumbleTemplate, getRerollTumbleTemplate
} from "./game/rerollTumbles";
import { loadDieAsset } from "./dieAsset";
import { cubeSymmetryCorrection } from "./diceOrientation";
import { liveRolls, rollScreenPosition, type RollPresentation } from "./diceSceneBridge";

export interface Reroll3DDie {
  id: string;
  initialValue: DiceValue;
  finalValue: DiceValue;
  playerColor?: PlayerColor;
  playerIndex?: number;
}

export const COLOR_BY_PLAYER: Record<PlayerColor, string> = {
  blue: "#0877c9",
  red: "#d43a2a",
  green: "#079842",
  yellow: "#e0a317"
};


export const DIE_RENDER_SIZE = 1.04;
export const DIE_FLOOR_CENTER_Y = DIE_RENDER_SIZE / 2 + 0.01;
const SETTLE_ROCK_DURATION_MS = 260;

/** Playback contributes actual meshes to the same scene as resting and dragged dice. */
export default function RerollDice3D({
  dice, playerColor, variant, launchSide = "bottom", openingPlayerIndexes,
  onSettled, onSettledCenters
}: {
  dice: Reroll3DDie[];
  playerColor: PlayerColor;
  variant: number;
  launchSide?: "top" | "right" | "bottom" | "left";
  openingPlayerIndexes?: number[];
  onSettled?: () => void;
  onSettledCenters?: (centers: Record<string, { x: number; y: number }>) => void;
}): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const settledRef = useRef(onSettled);
  const centersRef = useRef(onSettledCenters);
  settledRef.current = onSettled;
  centersRef.current = onSettledCenters;
  const diceSignature = useMemo(() => dice.map(d =>
    `${d.id}:${d.initialValue}:${d.finalValue}:${d.playerColor ?? playerColor}`).join("|"), [dice, playerColor]);
  const openingSignature = openingPlayerIndexes?.join(",") ?? "";

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !dice.length) return;
    let disposed = false;
    let frame = 0;
    const token = Symbol("roll");
    setReady(false);
    setFailed(false);
    void (async () => {
      try {
        const [template] = await Promise.all([
          openingPlayerIndexes ? getOpeningRollTumbleTemplate(openingPlayerIndexes, variant)
            : getRerollTumbleTemplate(dice.length, variant),
          loadDieAsset()
        ]);
        if (disposed) return;
        const presentation: RollPresentation = {
          host,
          dice: dice.map(d => ({
            id: d.id, color: d.playerColor ?? playerColor,
            position: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
            scale: new THREE.Vector3(1, 1, 1)
          }))
        };
        const corrections = dice.map((die, index) => {
          const track = template.tracks[index];
          return {
            start: orientationCorrection(quaternionAtFrame(track.samples, 0), finalDieQuaternion(die.initialValue, variant, index)),
            end: cubeSymmetryCorrection(quaternionAtFrame(track.samples, template.frameCount - 1), die.finalValue)
          };
        });
        const axis = new THREE.Vector3(0, 1, 0);
        const angle = openingPlayerIndexes ? 0 : launchRotationForSide(launchSide);
        const launch = new THREE.Quaternion().setFromAxisAngle(axis, angle);
        const lower = new THREE.Quaternion();
        const upper = new THREE.Quaternion();
        const correction = new THREE.Quaternion();
        const rockQ = new THREE.Quaternion();
        const euler = new THREE.Euler();
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const start = performance.now();
        let reported = false;
        const render = (now: number) => {
          if (disposed) return;
          const elapsed = reduced ? template.durationMs + SETTLE_ROCK_DURATION_MS : now - start;
          const time = Math.min(template.durationMs, elapsed);
          const exact = time * template.frameRate / 1000;
          const a = Math.min(template.frameCount - 1, Math.floor(exact));
          const b = Math.min(template.frameCount - 1, a + 1);
          presentation.dice.forEach((pose, index) => {
            const track = template.tracks[index];
            const offsetA = a * REROLL_SAMPLE_COMPONENTS;
            const offsetB = b * REROLL_SAMPLE_COMPONENTS;
            for (let component = 0; component < 3; component++) {
              pose.position.setComponent(component, THREE.MathUtils.lerp(
                track.samples[offsetA + component], track.samples[offsetB + component], exact - a));
            }
            if (!openingPlayerIndexes) {
              const gather = gatherPresentation(time, index, dice.length, pose.position);
              pose.position.set(gather.x, gather.y, gather.z);
            }
            pose.position.applyAxisAngle(axis, angle);
            lower.fromArray(track.samples, offsetA + 3).normalize();
            upper.fromArray(track.samples, offsetB + 3).normalize();
            pose.quaternion.slerpQuaternions(lower, upper, exact - a);
            // Finish changing the numbered faces during the release. A fixed cube
            // symmetry thereafter preserves the collider's exact shape and yaw.
            correction.slerpQuaternions(corrections[index].start, corrections[index].end,
              smoothStep((time - 120) / (openingPlayerIndexes ? 300 : 520)));
            const rock = settlingRock(elapsed, track.settleTimeMs, variant, index);
            rockQ.setFromEuler(euler.set(rock.x, 0, rock.z));
            pose.quaternion.premultiply(launch).multiply(correction).multiply(rockQ);
            // Rigid plastic retains its shape through impacts.
            pose.scale.setScalar(1);
          });
          liveRolls.set(token, presentation);
          if (!reported && time >= template.durationMs) {
            reported = true;
            centersRef.current?.(Object.fromEntries(presentation.dice.map(pose =>
              [pose.id, rollScreenPosition(presentation, pose.position)])));
            settledRef.current?.();
          }
          if (elapsed < template.durationMs + SETTLE_ROCK_DURATION_MS) frame = requestAnimationFrame(render);
        };
        render(start);
        setReady(true);
      } catch (error) {
        if (!disposed) {
          console.error("Unable to prepare dice", error);
          setFailed(true);
          settledRef.current?.();
        }
      }
    })();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      liveRolls.delete(token);
    };
  }, [diceSignature, playerColor, variant, launchSide, openingSignature]);

  return <div className="reroll-3d-stage" ref={hostRef} aria-hidden="true">
    <div className={ready ? "reroll-3d-emergency-fallback" : failed ? "reroll-3d-fallback" : "reroll-3d-loading-dice"}>
      {dice.map(die => <span key={die.id} className="reroll-3d-loading-die-fallback"
        data-live-die-3d={!failed && !ready ? "true" : undefined}
        data-live-die-value={die.initialValue}
        data-live-die-color={die.playerColor ?? playerColor}
        style={{ "--fallback-die-color": COLOR_BY_PLAYER[die.playerColor ?? playerColor] } as React.CSSProperties}>
        {failed || ready ? die.finalValue : die.initialValue}
      </span>)}
    </div>
  </div>;
}

export function launchRotationForSide(side: "top" | "right" | "bottom" | "left"): number {
  if (side === "top") return Math.PI;
  if (side === "left") return -Math.PI / 2;
  if (side === "right") return Math.PI / 2;
  return 0;
}


export function orientationCorrection(
  baseOrientation: THREE.Quaternion,
  desiredOrientation: THREE.Quaternion
): THREE.Quaternion {
  return baseOrientation.clone().invert().multiply(desiredOrientation);
}

export function gatherPresentation(
  elapsedMs: number,
  index: number,
  count: number,
  launchPosition: THREE.Vector3
): { x: number; y: number; z: number } {
  const progress = smoothStep(Math.max(0, Math.min(1, elapsedMs / REROLL_GATHER_DURATION_MS)));
  if (progress >= 1) {
    return { x: launchPosition.x, y: launchPosition.y, z: launchPosition.z };
  }

  const columns = Math.min(5, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / columns);
  const column = index % columns;
  const row = Math.floor(index / columns);
  const startX = (column - (columns - 1) / 2) * 0.94;
  const startZ = (row - (rows - 1) / 2) * 0.88 + 0.18;
  return {
    x: THREE.MathUtils.lerp(startX, launchPosition.x, progress),
    y: THREE.MathUtils.lerp(DIE_FLOOR_CENTER_Y, launchPosition.y, progress)
      + Math.sin(progress * Math.PI) * 0.62,
    z: THREE.MathUtils.lerp(startZ, launchPosition.z, progress)
  };
}
export function settlingRock(
  elapsedMs: number,
  settleTimeMs: number,
  variant: number,
  index: number
): { x: number; z: number } {
  const ageMs = elapsedMs - settleTimeMs;
  if (ageMs <= 0 || ageMs >= SETTLE_ROCK_DURATION_MS) return { x: 0, z: 0 };
  const envelope = (1 - ageMs / SETTLE_ROCK_DURATION_MS) ** 2;
  const direction = (variant + index) % 2 === 0 ? 1 : -1;
  return {
    x: Math.sin(ageMs / (34 + (index % 3) * 3)) * envelope * 0.026 * direction,
    z: Math.sin(ageMs / (43 + (variant % 3) * 4)) * envelope * 0.019 * -direction
  };
}


function quaternionAtFrame(samples: Float32Array, frame: number): THREE.Quaternion {
  const offset = frame * REROLL_SAMPLE_COMPONENTS;
  return new THREE.Quaternion().fromArray(samples, offset + 3).normalize();
}
export function finalDieQuaternion(value: DiceValue, variant: number, index: number): THREE.Quaternion {
  const base = new THREE.Quaternion();
  if (value === 6) base.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  if (value === 2) base.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  if (value === 5) base.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  if (value === 3) base.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  if (value === 4) base.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
  const yaw = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    ((variant * 5 + index * 7) % 16) * (Math.PI / 8)
  );
  return yaw.multiply(base);
}

function smoothStep(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}
