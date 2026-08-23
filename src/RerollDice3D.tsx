import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { DiceValue, PlayerColor } from "./game/types";
import {
  REROLL_GATHER_DURATION_MS,
  REROLL_SAMPLE_COMPONENTS,
  getOpeningRollTumbleTemplate,
  getRerollTumbleTemplate,
  type RerollImpactEvent,
  type RerollTumbleTemplate
} from "./game/rerollTumbles";

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

const FACE_VALUES: DiceValue[] = [3, 4, 1, 6, 2, 5];
export const DIE_RENDER_SIZE = 1.04;
export const DIE_FLOOR_CENTER_Y = DIE_RENDER_SIZE / 2 + 0.01;
export const DIE_EDGE_RADIUS = 0.205;
export const DIE_SURFACE_ROUGHNESS = 0.22;
export const DIE_PIP_RECESS_SCALE = 0.036;
const SETTLE_ROCK_DURATION_MS = 260;
const PIP_LAYOUT: Record<DiceValue, Array<[number, number]>> = {
  1: [[0.5, 0.5]],
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
  6: [[0.28, 0.24], [0.72, 0.24], [0.28, 0.5], [0.72, 0.5], [0.28, 0.76], [0.72, 0.76]]
};


export default function RerollDice3D({
  dice,
  playerColor,
  variant,
  launchSide = "bottom",
  openingPlayerIndexes,
  onSettled,
  onSettledCenters
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
  const [webGlFailed, setWebGlFailed] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const onSettledRef = useRef(onSettled);
  const onSettledCentersRef = useRef(onSettledCenters);
  onSettledRef.current = onSettled;
  onSettledCentersRef.current = onSettledCenters;
  const openingPlayerIndexesSignature = openingPlayerIndexes?.join(",") ?? "";
  const diceSignature = useMemo(
    () => dice.map((die) => {
      return `${die.id}:${die.initialValue}>${die.finalValue}:${die.playerColor ?? playerColor}:${die.playerIndex ?? "reroll"}`;
    }).join("|"),
    [dice, playerColor]
  );


  useEffect(() => {
    const host = hostRef.current;
    if (!host || dice.length === 0) return;

    setSceneReady(false);
    let disposed = false;
    let disposeScene: (() => void) | undefined;
    void (async () => {
      let template: RerollTumbleTemplate;
      try {
        template = openingPlayerIndexes
          ? await getOpeningRollTumbleTemplate(openingPlayerIndexes, variant)
          : await getRerollTumbleTemplate(dice.length, variant);
      } catch {
        if (!disposed) {
          setWebGlFailed(true);
          onSettledRef.current?.();
        }
        return;
      }
      if (disposed) return;

      let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "high-performance"
      });
    } catch {
      setWebGlFailed(true);
      onSettledRef.current?.();
      return;
    }

    setWebGlFailed(false);
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.82;
    renderer.domElement.className = "reroll-3d-canvas";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const roomEnvironment = new RoomEnvironment();
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const environmentTarget = pmremGenerator.fromScene(roomEnvironment, 0.03);
    scene.environment = environmentTarget.texture;
    scene.environmentIntensity = 0.11;

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 45);
    camera.position.set(0, 14.8, 3.55);
    camera.lookAt(0, 0.1, 0);

    scene.add(new THREE.HemisphereLight(0xfff4dc, 0x301507, 0.62));
    const keyLight = new THREE.DirectionalLight(0xffeed0, 2.35);
    keyLight.position.set(4.6, 8.8, -4.6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -7;
    keyLight.shadow.camera.right = 7;
    keyLight.shadow.camera.top = 5;
    keyLight.shadow.camera.bottom = -5;
    keyLight.shadow.bias = -0.0008;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x91b8e8, 0.2);
    fillLight.position.set(-4.5, 3.2, 4.2);
    scene.add(fillLight);

    // Broad studio lights make the rounded plastic read as a solid, glossy object
    // instead of painting a fixed highlight onto each rotating face.
    const stripKey = new THREE.RectAreaLight(0xfff4df, 4.4, 4.8, 1.15);
    stripKey.position.set(3.8, 5.8, -3.8);
    stripKey.lookAt(0, 0.25, 0);
    scene.add(stripKey);
    const stripRim = new THREE.RectAreaLight(0xb9d7ff, 1.25, 1.1, 3.8);
    stripRim.position.set(-4.2, 3.2, 3.1);
    stripRim.lookAt(0, 0.3, 0);
    scene.add(stripRim);

    const floorGeometry = new THREE.PlaneGeometry(11.2, 11.2);
    const floorMaterial = new THREE.ShadowMaterial({
      color: 0x4f260c,
      opacity: 0.18,
      transparent: true
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);


    const dieColors = [...new Set(dice.map((die) => die.playerColor ?? playerColor))];
    const faceResources = new Map(dieColors.map((color) => [color, createDieFaceResources(color)]));
    const dieGeometry = createDieGeometry();
    const meshes = dice.map((die) => {
      const materials = faceResources.get(die.playerColor ?? playerColor)?.materials
        ?? faceResources.values().next().value?.materials;
      const mesh = new THREE.Mesh(dieGeometry, materials);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    });

    const shadowTexture = createShadowTexture();
    const shadowGeometry = new THREE.CircleGeometry(1, 48);
    const shadowMaterials = dice.map(() => new THREE.MeshBasicMaterial({
      map: shadowTexture,
      color: 0x4f260c,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      toneMapped: false
    }));
    const shadows = shadowMaterials.map((material) => {
      const shadow = new THREE.Mesh(shadowGeometry, material);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.008;
      shadow.renderOrder = -1;
      scene.add(shadow);
      return shadow;
    });
    const impacts = template.tracks.map((track) => track.impacts);
    const orientationCorrections = dice.map((die, index) => {
      const track = template.tracks[index];
      const baseStart = quaternionAtFrame(track.samples, 0);
      const baseEnd = quaternionAtFrame(track.samples, template.frameCount - 1);
      return {
        start: orientationCorrection(baseStart, finalDieQuaternion(die.initialValue, variant, index)),
        end: orientationCorrection(baseEnd, finalDieQuaternion(die.finalValue, variant, index))
      };
    });
    const launchRotation = openingPlayerIndexes ? 0 : launchRotationForSide(launchSide);
    const launchAxis = new THREE.Vector3(0, 1, 0);
    const launchQuaternion = new THREE.Quaternion().setFromAxisAngle(launchAxis, launchRotation);
    const localPosition = new THREE.Vector3();
    const tumbleQuaternion = new THREE.Quaternion();
    const lowerQuaternion = new THREE.Quaternion();
    const upperQuaternion = new THREE.Quaternion();
    const correctionQuaternion = new THREE.Quaternion();
    const rockQuaternion = new THREE.Quaternion();
    const rockEuler = new THREE.Euler();
    const projectedPosition = new THREE.Vector3();
    let reportedSettledCenters = false;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const startTime = performance.now();
    let animationFrame = 0;

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    const renderFrame = (now: number) => {
      const renderDurationMs = template.durationMs + SETTLE_ROCK_DURATION_MS;
      const elapsedMs = reducedMotion
        ? renderDurationMs
        : Math.min(renderDurationMs, now - startTime);
      const sampleElapsedMs = Math.min(template.durationMs, elapsedMs);
      const exactFrame = (sampleElapsedMs / 1000) * template.frameRate;
      const lowerFrame = Math.min(template.frameCount - 1, Math.floor(exactFrame));
      const upperFrame = Math.min(template.frameCount - 1, lowerFrame + 1);
      const frameMix = exactFrame - lowerFrame;

      meshes.forEach((mesh, index) => {
        const track = template.tracks[index];
        const lowerOffset = lowerFrame * REROLL_SAMPLE_COMPONENTS;
        const upperOffset = upperFrame * REROLL_SAMPLE_COMPONENTS;
        localPosition.set(
          THREE.MathUtils.lerp(track.samples[lowerOffset], track.samples[upperOffset], frameMix),
          THREE.MathUtils.lerp(track.samples[lowerOffset + 1], track.samples[upperOffset + 1], frameMix),
          THREE.MathUtils.lerp(track.samples[lowerOffset + 2], track.samples[upperOffset + 2], frameMix)
        );
        const gather = openingPlayerIndexes
          ? { x: localPosition.x, y: localPosition.y, z: localPosition.z }
          : gatherPresentation(sampleElapsedMs, index, dice.length, localPosition);
        localPosition.set(gather.x, gather.y, gather.z);
        mesh.position.copy(localPosition).applyAxisAngle(launchAxis, launchRotation);
        lowerQuaternion.fromArray(track.samples, lowerOffset + 3).normalize();
        upperQuaternion.fromArray(track.samples, upperOffset + 3).normalize();
        tumbleQuaternion.slerpQuaternions(lowerQuaternion, upperQuaternion, frameMix);
        const retargetProgress = smoothStep(
          (sampleElapsedMs - 280) / Math.max(1, track.settleTimeMs - 980)
        );
        correctionQuaternion.slerpQuaternions(
          orientationCorrections[index].start,
          orientationCorrections[index].end,
          retargetProgress
        );
        const rock = settlingRock(elapsedMs, track.settleTimeMs, variant, index);
        rockEuler.set(rock.x, 0, rock.z);
        rockQuaternion.setFromEuler(rockEuler);
        mesh.quaternion.copy(launchQuaternion).multiply(tumbleQuaternion).multiply(correctionQuaternion).multiply(rockQuaternion);

        const latestImpact = latestImpactAt(impacts[index], sampleElapsedMs);
        const deformation = latestImpact
          ? impactDeformation(sampleElapsedMs - latestImpact.timeMs, latestImpact.strength)
          : { horizontal: 1, vertical: 1 };
        mesh.scale.set(deformation.horizontal, deformation.vertical, deformation.horizontal);

        const shadow = shadowPresentation(mesh.position.y);
        shadows[index].position.x = mesh.position.x + shadow.offsetX;
        shadows[index].position.z = mesh.position.z + shadow.offsetZ;
        shadows[index].scale.set(shadow.scaleX, shadow.scaleZ, 1);
        shadowMaterials[index].opacity = shadow.opacity;
      });

      if (!reportedSettledCenters && sampleElapsedMs >= template.durationMs) {
        const hostRect = host.getBoundingClientRect();
        const centers = Object.fromEntries(meshes.map((mesh, index) => {
          projectedPosition.copy(mesh.position).project(camera);
          return [
            dice[index].id,
            {
              x: hostRect.left + (projectedPosition.x * 0.5 + 0.5) * hostRect.width,
              y: hostRect.top + (-projectedPosition.y * 0.5 + 0.5) * hostRect.height
            }
          ];
        }));
        reportedSettledCenters = true;
        onSettledCentersRef.current?.(centers);
        onSettledRef.current?.();
      }

      renderer.render(scene, camera);
      if (!reducedMotion) {
        animationFrame = window.requestAnimationFrame(renderFrame);
      }
    };
    renderFrame(startTime);
    if (!disposed) setSceneReady(true);

    disposeScene = () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      meshes.forEach((mesh) => scene.remove(mesh));
      shadows.forEach((shadow) => scene.remove(shadow));
      dieGeometry.dispose();
      shadowGeometry.dispose();
      shadowTexture.dispose();
      shadowMaterials.forEach((material) => material.dispose());
      floorGeometry.dispose();
      floorMaterial.dispose();
      faceResources.forEach((resource) => resource.dispose());

      environmentTarget.dispose();
      pmremGenerator.dispose();
      roomEnvironment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
    })();

    return () => {
      disposed = true;
      disposeScene?.();
    };
  }, [diceSignature, launchSide, openingPlayerIndexesSignature, playerColor, variant]);

  return (
    <div className="reroll-3d-stage" ref={hostRef} aria-hidden="true">
      {!sceneReady && !webGlFailed ? (
        <div className="reroll-3d-loading-dice">
          {dice.map((die) => (
            <span
              className="reroll-3d-loading-die-fallback"
              key={die.id}
              data-live-die-3d="true"
              data-live-die-value={die.initialValue}
              data-live-die-color={die.playerColor ?? playerColor}
              style={{ "--fallback-die-color": COLOR_BY_PLAYER[die.playerColor ?? playerColor] } as React.CSSProperties}
            >
              {die.initialValue}
            </span>
          ))}
        </div>
      ) : null}
      {webGlFailed ? (
        <div className="reroll-3d-fallback">
          {dice.map((die) => (
            <span key={die.id} style={{ "--fallback-die-color": COLOR_BY_PLAYER[die.playerColor ?? playerColor] } as React.CSSProperties}>
              {die.finalValue}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function launchRotationForSide(side: "top" | "right" | "bottom" | "left"): number {
  if (side === "top") return Math.PI;
  if (side === "left") return -Math.PI / 2;
  if (side === "right") return Math.PI / 2;
  return 0;
}

export function createShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 3, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.92)");
    gradient.addColorStop(0.34, "rgba(255, 255, 255, 0.56)");
    gradient.addColorStop(0.72, "rgba(255, 255, 255, 0.16)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

interface FaceSurface {
  color: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
}

export function createDieGeometry(): RoundedBoxGeometry {
  return new RoundedBoxGeometry(
    DIE_RENDER_SIZE,
    DIE_RENDER_SIZE,
    DIE_RENDER_SIZE,
    16,
    DIE_EDGE_RADIUS
  );
}

export function createDieFaceResources(playerColor: PlayerColor): {
  materials: THREE.MeshPhysicalMaterial[];
  dispose: () => void;
} {
  const surfaces = FACE_VALUES.map((value) => createFaceSurface(COLOR_BY_PLAYER[playerColor], value));
  const materials = surfaces.map(({ color, bump }) => new THREE.MeshPhysicalMaterial({
    map: color,
    bumpMap: bump,
    bumpScale: DIE_PIP_RECESS_SCALE,
    color: 0xffffff,
    roughness: DIE_SURFACE_ROUGHNESS,
    metalness: 0,
    clearcoat: 0.72,
    clearcoatRoughness: 0.18,
    ior: 1.48,
    specularIntensity: 0.72,
    specularColor: new THREE.Color(0xfff8e8),
    envMapIntensity: 0.32
  }));
  return {
    materials,
    dispose: () => {
      materials.forEach((material) => material.dispose());
      surfaces.forEach(({ color, bump }) => {
        color.dispose();
        bump.dispose();
      });
    }
  };
}

function createFaceSurface(color: string, value: DiceValue): FaceSurface {
  return {
    color: createFaceTexture(color, value),
    bump: createFaceBumpTexture(value)
  };
}

function createFaceBumpTexture(value: DiceValue): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#b8b8b8";
    context.fillRect(0, 0, 256, 256);
    PIP_LAYOUT[value].forEach(([x, y]) => {
      const centerX = x * 256;
      const centerY = y * 256;
      const recess = context.createRadialGradient(centerX, centerY, 2, centerX, centerY, 27);
      recess.addColorStop(0, "#686868");
      recess.addColorStop(0.62, "#747474");
      recess.addColorStop(0.84, "#9c9c9c");
      recess.addColorStop(1, "#b8b8b8");
      context.fillStyle = recess;
      context.beginPath();
      context.arc(centerX, centerY, 28, 0, Math.PI * 2);
      context.fill();
    });
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  return texture;
}

function createFaceTexture(color: string, value: DiceValue): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);

  // Keep pigment nearly uniform. Moving highlights and shading come from the
  // scene lights/environment, as they do on a real injection-moulded die.
  context.fillStyle = color;
  context.fillRect(0, 0, 256, 256);

  const pigmentVariation = context.createRadialGradient(128, 124, 8, 128, 124, 180);
  pigmentVariation.addColorStop(0, "rgba(255, 255, 255, 0.025)");
  pigmentVariation.addColorStop(1, "rgba(0, 0, 0, 0.035)");
  context.fillStyle = pigmentVariation;
  context.fillRect(0, 0, 256, 256);

  PIP_LAYOUT[value].forEach(([x, y]) => {
    const centerX = x * 256;
    const centerY = y * 256;
    context.beginPath();
    context.arc(centerX + 1.5, centerY + 2, 24.5, 0, Math.PI * 2);
    context.fillStyle = "rgba(24, 10, 3, 0.31)";
    context.fill();
    context.beginPath();
    context.arc(centerX, centerY, 22, 0, Math.PI * 2);
    const pipGradient = context.createRadialGradient(centerX - 5, centerY - 6, 1, centerX, centerY, 23);
    pipGradient.addColorStop(0, "#ffffff");
    pipGradient.addColorStop(0.76, "#fffdf3");
    pipGradient.addColorStop(1, "#d7d2c2");
    context.fillStyle = pipGradient;
    context.fill();
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
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
export function shadowPresentation(centerY: number): {
  scaleX: number;
  scaleZ: number;
  opacity: number;
  offsetX: number;
  offsetZ: number;
} {
  const lift = smoothStep(Math.max(0, Math.min(1, (centerY - DIE_FLOOR_CENTER_Y) / 4.2)));
  return {
    scaleX: THREE.MathUtils.lerp(0.9, 1.28, lift),
    scaleZ: THREE.MathUtils.lerp(0.62, 0.98, lift),
    opacity: THREE.MathUtils.lerp(0.44, 0.055, lift),
    offsetX: THREE.MathUtils.lerp(-0.18, -0.54, lift),
    offsetZ: THREE.MathUtils.lerp(0.16, 0.5, lift)
  };
}

export function impactDeformation(ageMs: number, strength: number): { horizontal: number; vertical: number } {
  if (ageMs < 0 || ageMs > 190) return { horizontal: 1, vertical: 1 };
  const safeStrength = Math.max(0, Math.min(1, strength));
  const pulse = Math.max(-0.22, Math.exp(-ageMs / 82) * Math.cos(ageMs / 36));
  const compression = pulse * safeStrength * 0.032;
  return {
    horizontal: 1 + compression * 0.5,
    vertical: 1 - compression
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


function latestImpactAt(events: RerollImpactEvent[], elapsedMs: number): RerollImpactEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].timeMs <= elapsedMs) return events[index];
  }
  return undefined;
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

function mixHex(left: string, right: string, amount: number): string {
  const parse = (value: string, offset: number) => Number.parseInt(value.slice(offset, offset + 2), 16);
  const channels = [1, 3, 5].map((offset) => Math.round(
    parse(left, offset) * (1 - amount) + parse(right, offset) * amount
  ));
  return "#" + channels.map((channel) => channel.toString(16).padStart(2, "0")).join("");
}


