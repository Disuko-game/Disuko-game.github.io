import { useEffect, type ReactElement } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { DiceValue, PlayerColor } from "./game/types";
import {
  DIE_FLOOR_CENTER_Y,
  createDieFaceResources,
  createDieGeometry,
  createShadowTexture,
  finalDieQuaternion,
  shadowPresentation
} from "./RerollDice3D";
import { playerColorForOwner } from "./StaticDie3D";

const LIVE_DIE_SELECTOR = '[data-live-die-3d="true"]';
const RESTING_TARGET_FPS = 30;
const MOVING_TARGET_FPS = 60;
const BASE_CAMERA_ZOOM = 6.25;
const BASE_REGION_SCALE = 1.9;

function animationProgress(element: Element): number | null {
  const animation = element.getAnimations()[0];
  const progress = animation?.effect?.getComputedTiming().progress;
  return typeof progress === "number" ? Math.max(0, Math.min(1, progress)) : null;
}

function presentationHeight(target: HTMLElement): number {
  if (target.closest(".drag-preview")) return DIE_FLOOR_CENTER_Y + 1.55;

  const movingPreview = target.closest(".bot-drag-preview, .invalid-return-preview");
  if (movingPreview) {
    const progress = animationProgress(movingPreview) ?? 0.5;
    return DIE_FLOOR_CENTER_Y + 0.2 + Math.sin(progress * Math.PI) * 1.45;
  }

  if (target.classList.contains("is-landing")) {
    const progress = animationProgress(target) ?? 0.5;
    return DIE_FLOOR_CENTER_Y + (1 - progress) * 0.9;
  }

  return DIE_FLOOR_CENTER_Y;
}

export function tabletopFacingAngle(element: Element): number {
  if (element.closest(".tabletop-facing-top")) return Math.PI;
  if (element.closest(".tabletop-facing-left")) return Math.PI / 2;
  if (element.closest(".tabletop-facing-right")) return -Math.PI / 2;
  return 0;
}

export function liveDieValue(element: HTMLElement): DiceValue | null {
  const value = Number(element.dataset.liveDieValue);
  return value >= 1 && value <= 6 && Number.isInteger(value) ? value as DiceValue : null;
}

export default function LiveDice3DLayer({ onReady }: { onReady: () => void }): ReactElement | null {
  useEffect(() => {
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    } catch {
      return;
    }

    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.82;
    renderer.autoClear = false;
    renderer.domElement.className = "live-dice-3d-canvas";
    renderer.domElement.setAttribute("aria-hidden", "true");
    document.body.appendChild(renderer.domElement);

    const badgeLayer = document.createElement("div");
    badgeLayer.className = "live-dice-badge-layer";
    badgeLayer.setAttribute("aria-hidden", "true");
    document.body.appendChild(badgeLayer);
    document.documentElement.classList.add("live-dice-3d-overlay-ready");
    const badgeOverlays = new Map<HTMLElement, HTMLElement>();
    const lockOverlays = new Map<HTMLElement, HTMLElement>();
    const messageOverlays = new Map<HTMLElement, HTMLElement>();

    const scene = new THREE.Scene();
    const roomEnvironment = new RoomEnvironment();
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const environmentTarget = pmremGenerator.fromScene(roomEnvironment, 0.03);
    scene.environment = environmentTarget.texture;
    scene.environmentIntensity = 0.11;

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 45);
    camera.position.set(0, 14.8, 3.55);
    camera.lookAt(0, 0.1, 0);
    camera.zoom = BASE_CAMERA_ZOOM;
    camera.updateProjectionMatrix();

    scene.add(new THREE.HemisphereLight(0xfff4dc, 0x301507, 0.72));
    const keyLight = new THREE.DirectionalLight(0xffeed0, 2.35);
    keyLight.position.set(4.6, 8.8, -4.6);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x91b8e8, 0.2);
    fillLight.position.set(-4.5, 3.2, 4.2);
    scene.add(fillLight);
    const stripKey = new THREE.RectAreaLight(0xfff4df, 4.4, 4.8, 1.15);
    stripKey.position.set(3.8, 5.8, -3.8);
    stripKey.lookAt(0, 0.25, 0);
    scene.add(stripKey);
    const stripRim = new THREE.RectAreaLight(0xb9d7ff, 1.25, 1.1, 3.8);
    stripRim.position.set(-4.2, 3.2, 3.1);
    stripRim.lookAt(0, 0.3, 0);
    scene.add(stripRim);

    const geometry = createDieGeometry();
    const resources = new Map<PlayerColor, ReturnType<typeof createDieFaceResources>>();
    (["blue", "red", "green", "yellow"] as PlayerColor[]).forEach((color) => {
      resources.set(color, createDieFaceResources(color));
    });
    const mesh = new THREE.Mesh(geometry, resources.get("blue")?.materials);
    scene.add(mesh);

    const shadowTexture = createShadowTexture();
    const shadowGeometry = new THREE.CircleGeometry(1, 48);
    const shadowMaterial = new THREE.MeshBasicMaterial({
      map: shadowTexture,
      color: 0x2c1407,
      transparent: true,
      opacity: 0.44,
      depthWrite: false,
      toneMapped: false
    });
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.008;
    const groundedShadow = shadowPresentation(DIE_FLOOR_CENTER_Y);
    shadow.position.x = groundedShadow.offsetX;
    shadow.position.z = groundedShadow.offsetZ;
    shadow.scale.set(groundedShadow.scaleX, groundedShadow.scaleZ, 1);
    scene.add(shadow);

    const viewAxis = camera.position.clone().normalize();
    const facingQuaternion = new THREE.Quaternion();
    let width = 0;
    let height = 0;
    let animationFrame = 0;
    let lastRenderTime = 0;
    let ready = false;

    const resize = () => {
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(width, height, false);
    };

    const render = (now: number) => {
      animationFrame = window.requestAnimationFrame(render);
      const movingDiceVisible = Boolean(document.querySelector(
        ".floating-reroll-tray.is-returning, .drag-preview, .bot-drag-preview, .invalid-return-preview, .die-face.is-landing"
      ));
      const targetFps = movingDiceVisible ? MOVING_TARGET_FPS : RESTING_TARGET_FPS;
      if (document.hidden || now - lastRenderTime < 1000 / targetFps) return;
      lastRenderTime = now;
      if (width !== window.innerWidth || height !== window.innerHeight) resize();

      renderer.setScissorTest(false);
      renderer.clear(true, true, true);
      renderer.setScissorTest(true);

      let renderedAny = false;
      const visibleBadges = new Set<HTMLElement>();
      const visibleLocks = new Set<HTMLElement>();
      const targets = Array.from(document.querySelectorAll<HTMLElement>(LIVE_DIE_SELECTOR));
      const rerollTray = document.querySelector<HTMLElement>(".floating-reroll-tray");
      const rerollTrayRect = rerollTray?.getBoundingClientRect();
      for (const target of targets) {
        const value = liveDieValue(target);
        const rect = target.getBoundingClientRect();
        if (!value || rect.width < 4 || rect.height < 4 || rect.bottom < 0 || rect.top > height || rect.right < 0 || rect.left > width) {
          continue;
        }
        const style = window.getComputedStyle(target);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;

        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const isFloatingDie = Boolean(target.closest(
          ".drag-preview, .bot-drag-preview, .invalid-return-preview, .floating-reroll-tray.is-returning"
        ));
        const coveredByRerollTray = !isFloatingDie
          && rerollTrayRect
          && !target.closest(".floating-reroll-tray")
          && centerX >= rerollTrayRect.left
          && centerX <= rerollTrayRect.right
          && centerY >= rerollTrayRect.top
          && centerY <= rerollTrayRect.bottom;
        if (coveredByRerollTray) continue;
        const hit = document.elementFromPoint(
          Math.max(0, Math.min(width - 1, centerX)),
          Math.max(0, Math.min(height - 1, centerY))
        );
        const coveredOnlyByLoader = Boolean(hit?.closest(".dice-render-loader"));
        const coveredOnlyByTurnPrompt = Boolean(hit?.closest(".turn-start-backdrop"));
        if (
          !isFloatingDie
          && !coveredOnlyByLoader
          && !coveredOnlyByTurnPrompt
          && hit
          && hit !== target
          && !target.contains(hit)
          && !hit.contains(target)
        ) continue;

        const explicitColor = target.dataset.liveDieColor as PlayerColor | undefined;
        const color = explicitColor ?? playerColorForOwner(target.dataset.liveDieOwner ?? "p1");
        const materialResource = resources.get(color) ?? resources.get("blue");
        if (!materialResource) continue;
        mesh.material = materialResource.materials;
        const dieHeight = presentationHeight(target);
        mesh.position.y = dieHeight;
        mesh.quaternion.copy(finalDieQuaternion(value, 0, 0));
        const facingAngle = tabletopFacingAngle(target) + (target.classList.contains("is-selected") ? -Math.PI / 90 : 0);
        if (facingAngle !== 0) {
          facingQuaternion.setFromAxisAngle(viewAxis, facingAngle);
          mesh.quaternion.premultiply(facingQuaternion);
        }

        const dieShadow = shadowPresentation(dieHeight);
        shadow.position.x = dieShadow.offsetX;
        shadow.position.z = dieShadow.offsetZ;
        shadow.scale.set(dieShadow.scaleX, dieShadow.scaleZ, 1);
        shadowMaterial.opacity = dieShadow.opacity;

        const targetSize = Math.max(rect.width, rect.height);
        const lift = Math.max(0, dieHeight - DIE_FLOOR_CENTER_Y);
        const regionScale = 2.08 + Math.min(0.84, lift * 0.54);
        const regionSize = Math.max(16, targetSize * regionScale);
        camera.zoom = BASE_CAMERA_ZOOM * (BASE_REGION_SCALE / regionScale);
        camera.updateProjectionMatrix();
        const viewportX = centerX - regionSize / 2;
        const viewportY = height - centerY - regionSize / 2;
        renderer.setViewport(viewportX, viewportY, regionSize, regionSize);
        renderer.setScissor(viewportX, viewportY, regionSize, regionSize);
        renderer.clearDepth();
        renderer.render(scene, camera);
        renderedAny = true;

        const sourceBadge = target.querySelector<HTMLElement>(":scope > .die-multiplier");
        if (sourceBadge) {
          let overlayBadge = badgeOverlays.get(target);
          if (!overlayBadge) {
            overlayBadge = sourceBadge.cloneNode(true) as HTMLElement;
            overlayBadge.classList.add("live-die-multiplier");
            badgeLayer.appendChild(overlayBadge);
            badgeOverlays.set(target, overlayBadge);
          }

          const badgeRect = sourceBadge.getBoundingClientRect();
          const badgeStyle = window.getComputedStyle(sourceBadge);
          const facingDegrees = tabletopFacingAngle(target) * (180 / Math.PI);
          overlayBadge.textContent = sourceBadge.textContent;
          overlayBadge.style.left = `${badgeRect.left + badgeRect.width / 2}px`;
          overlayBadge.style.top = `${badgeRect.top + badgeRect.height / 2}px`;
          overlayBadge.style.width = `${sourceBadge.offsetWidth}px`;
          overlayBadge.style.height = `${sourceBadge.offsetHeight}px`;
          overlayBadge.style.fontSize = badgeStyle.fontSize;
          overlayBadge.style.padding = badgeStyle.padding;
          overlayBadge.style.color = badgeStyle.color;
          overlayBadge.style.background = badgeStyle.background;
          overlayBadge.style.border = badgeStyle.border;
          overlayBadge.style.borderRadius = badgeStyle.borderRadius;
          overlayBadge.style.boxShadow = badgeStyle.boxShadow;
          overlayBadge.style.transform = `translate(-50%, -50%) rotate(${facingDegrees}deg)`;
          visibleBadges.add(target);
        }

        const sourceLock = target.querySelector<HTMLElement>(":scope > .die-lock-icon");
        if (sourceLock) {
          let overlayLock = lockOverlays.get(target);
          if (!overlayLock) {
            overlayLock = sourceLock.cloneNode(true) as HTMLElement;
            overlayLock.classList.add("live-die-lock-icon");
            badgeLayer.appendChild(overlayLock);
            lockOverlays.set(target, overlayLock);
          }

          const lockRect = sourceLock.getBoundingClientRect();
          const facingDegrees = tabletopFacingAngle(target) * (180 / Math.PI);
          overlayLock.style.left = `${lockRect.left + lockRect.width / 2}px`;
          overlayLock.style.top = `${lockRect.top + lockRect.height / 2}px`;
          overlayLock.style.width = `${sourceLock.offsetWidth}px`;
          overlayLock.style.height = `${sourceLock.offsetHeight}px`;
          overlayLock.style.transform = `translate(-50%, -50%) rotate(${facingDegrees}deg)`;
          visibleLocks.add(target);
        }
      }

      for (const [target, overlayBadge] of badgeOverlays) {
        if (!visibleBadges.has(target)) {
          overlayBadge.remove();
          badgeOverlays.delete(target);
        }
      }
      for (const [target, overlayLock] of lockOverlays) {
        if (!visibleLocks.has(target)) {
          overlayLock.remove();
          lockOverlays.delete(target);
        }
      }

      const visibleMessages = new Set<HTMLElement>();
      const sourceMessages = Array.from(document.querySelectorAll<HTMLElement>(
        ".board-grid > .completion-bonus-pop"
      ));
      for (const sourceMessage of sourceMessages) {
        let overlayMessage = messageOverlays.get(sourceMessage);
        if (!overlayMessage) {
          overlayMessage = sourceMessage.cloneNode(true) as HTMLElement;
          overlayMessage.classList.add("live-board-message");
          const sourceAnimationTime = sourceMessage.getAnimations()[0]?.currentTime;
          if (typeof sourceAnimationTime === "number") {
            overlayMessage.style.animationDelay = `-${sourceAnimationTime}ms`;
          }
          badgeLayer.appendChild(overlayMessage);
          messageOverlays.set(sourceMessage, overlayMessage);
        }

        const messageRect = sourceMessage.getBoundingClientRect();
        overlayMessage.style.left = `${messageRect.left + messageRect.width / 2}px`;
        overlayMessage.style.top = `${messageRect.top + messageRect.height / 2}px`;
        overlayMessage.style.width = `${sourceMessage.offsetWidth}px`;
        overlayMessage.style.height = `${sourceMessage.offsetHeight}px`;
        visibleMessages.add(sourceMessage);
      }
      for (const [sourceMessage, overlayMessage] of messageOverlays) {
        if (!visibleMessages.has(sourceMessage)) {
          overlayMessage.remove();
          messageOverlays.delete(sourceMessage);
        }
      }

      if (renderedAny && !ready) {
        ready = true;
        document.documentElement.classList.add("live-dice-3d-ready");
        onReady();
      }
    };

    resize();
    animationFrame = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.documentElement.classList.remove("live-dice-3d-ready");
      document.documentElement.classList.remove("live-dice-3d-overlay-ready");
      badgeOverlays.clear();
      lockOverlays.clear();
      messageOverlays.clear();
      badgeLayer.remove();
      geometry.dispose();
      resources.forEach((resource) => resource.dispose());
      shadowGeometry.dispose();
      shadowMaterial.dispose();
      shadowTexture.dispose();
      environmentTarget.dispose();
      pmremGenerator.dispose();
      roomEnvironment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [onReady]);

  return null;
}
