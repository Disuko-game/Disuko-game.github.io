import { useEffect, type ReactElement } from "react";
import * as THREE from "three";
import type { DiceValue, PlayerColor } from "./game/types";
import { DIE_FLOOR_CENTER_Y, finalDieQuaternion } from "./RerollDice3D";
import { playerColorForOwner } from "./StaticDie3D";
import { createDiePalette, loadDieAsset } from "./dieAsset";
import { liveRolls, rollScreenPosition, TABLE_CAMERA_COS, TABLE_CAMERA_SIN, TABLE_CAMERA_TILT } from "./diceSceneBridge";
import { createContactTexture, createTableLighting } from "./tableLighting";
import {
  BOARD_SURFACE_Y, TABLE_SURFACE_Y, TRAY_SURFACE_Y,
  createTableSurfaceFactory, type TableSurface, type TableSurfaceKind
} from "./tableSurfaces";

const LIVE_DIE_SELECTOR = '[data-live-die-3d="true"]';

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



interface VisibleDie {
  mesh: THREE.Group;
  contact: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  color: PlayerColor;
}

export default function LiveDice3DLayer({ onReady }: { onReady: () => void }): ReactElement | null {
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void loadDieAsset().then(asset => {
      if (disposed) return;
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.domElement.className = "live-dice-3d-canvas";
      renderer.domElement.setAttribute("aria-hidden", "true");
      document.body.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const lighting = createTableLighting(scene, renderer);
      const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
      camera.position.set(0, Math.cos(TABLE_CAMERA_TILT) * 80, Math.sin(TABLE_CAMERA_TILT) * 80);
      camera.lookAt(0, 0, 0);
      const palette = createDiePalette(asset);
      const contactTexture = createContactTexture();
      const contactGeometry = new THREE.PlaneGeometry(1, 1);
      const instances = new Map<HTMLElement | object, VisibleDie>();
      const shadowMaterial = new THREE.ShadowMaterial({ color: 0x30251b, opacity: 0.36, depthWrite: true });
      const surfaceFactory = createTableSurfaceFactory(renderer);
      const surfaces = new Map<Element, TableSurface>();
      const table = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMaterial);
      table.rotation.x = -Math.PI / 2;
      table.receiveShadow = true;
      scene.add(table);

      const badgeLayer = document.createElement("div");
      badgeLayer.className = "live-dice-badge-layer";
      badgeLayer.setAttribute("aria-hidden", "true");
      document.body.appendChild(badgeLayer);
      document.documentElement.classList.add("live-dice-3d-overlay-ready");
      const badgeOverlays = new Map<HTMLElement, HTMLElement>();
      const lockOverlays = new Map<HTMLElement, HTMLElement>();
      const messageOverlays = new Map<HTMLElement, HTMLElement>();
      let width = 0, height = 0, pixelsPerUnit = 32, frame = 0, lastTime = 0;
      let ready = false, lastShadowSignature = "";
      const worldPosition = (x: number, y: number, elevation: number, out: THREE.Vector3) =>
        out.set((x - width / 2) / pixelsPerUnit, elevation,
          ((y - height / 2) / pixelsPerUnit + elevation * TABLE_CAMERA_SIN) / TABLE_CAMERA_COS);

      const getDie = (key: HTMLElement | object, color: PlayerColor) => {
        let instance = instances.get(key);
        if (instance && instance.color !== color) {
          scene.remove(instance.mesh, instance.contact);
          instance.contact.material.dispose();
          instances.delete(key);
          instance = undefined;
        }
        if (!instance) {
          const mesh = palette.create(color);
          const contact = new THREE.Mesh(contactGeometry, new THREE.MeshBasicMaterial({
            map: contactTexture, transparent: true, opacity: 0.25, depthWrite: false, toneMapped: false
          }));
          contact.rotation.x = -Math.PI / 2;
          instance = { mesh, contact, color };
          instances.set(key, instance);
          scene.add(mesh, contact);
        }
        instance.mesh.visible = true;
        return instance;
      };

      const positionContact = (instance: VisibleDie, floor: number, size: number) => {
        const lift = instance.mesh.position.y - floor - DIE_FLOOR_CENTER_Y * size;
        instance.contact.visible = lift < 0.3 * size;
        instance.contact.position.set(instance.mesh.position.x, floor + 0.006, instance.mesh.position.z);
        instance.contact.scale.set(size * 1.35, size * 1.35, 1);
        instance.contact.material.opacity = Math.max(0, 0.24 * (1 - lift / (0.3 * size)));
      };

      const render = (now: number) => {
        frame = requestAnimationFrame(render);
        const moving = liveRolls.size > 0 || Boolean(document.querySelector(
          ".floating-reroll-tray.is-returning, .drag-preview, .bot-drag-preview, .invalid-return-preview, .die-face.is-landing"));
        if (document.hidden || now - lastTime < (moving ? 15 : 32)) return;
        lastTime = now;
        const board = document.querySelector<HTMLElement>(".board-grid");
        const boardRect = board?.getBoundingClientRect();
        const nextPixels = Math.max(18, (boardRect?.width ?? 320) / 9.6);
        if (width !== innerWidth || height !== innerHeight || Math.abs(nextPixels - pixelsPerUnit) > 0.01) {
          width = Math.max(1, innerWidth);
          height = Math.max(1, innerHeight);
          pixelsPerUnit = nextPixels;
          renderer.setSize(width, height, false);
          renderer.domElement.style.width = `${width}px`;
          renderer.domElement.style.height = `${height}px`;
          camera.left = -width / pixelsPerUnit / 2;
          camera.right = -camera.left;
          camera.top = height / pixelsPerUnit / 2;
          camera.bottom = -camera.top;
          camera.updateProjectionMatrix();
          lighting.resize(width / pixelsPerUnit, height / pixelsPerUnit);
          lastShadowSignature = "";
        }
        const modal = document.querySelector(".menu-backdrop, .winner-celebration");
        const rollTray = document.querySelector<HTMLElement>(".opening-roll-tray, .floating-reroll-tray");
        const rollRect = rollTray?.getBoundingClientRect();
        const returning = rollTray?.matches(".is-return-preparing, .is-returning") ?? false;
        const coveredByRoll = (rect: DOMRect) => !returning && rollRect &&
          rect.left + rect.width / 2 >= rollRect.left && rect.left + rect.width / 2 <= rollRect.right &&
          rect.top + rect.height / 2 >= rollRect.top && rect.top + rect.height / 2 <= rollRect.bottom;
        const activeSurfaceElements = new Set<Element>();
        for (const element of document.querySelectorAll<HTMLElement>(
          ".board-wrap, .dice-rail-groove, .opponent-dice-rail, .opening-roll-tray, .floating-reroll-tray")) {
          const rect = element.getBoundingClientRect();
          if (rect.width < 4 || rect.height < 4 || rect.bottom < 0 || rect.top > height || modal) continue;
          const style = getComputedStyle(element);
          if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") continue;
          if (element !== rollTray && coveredByRoll(rect)) continue;
          if (element === rollTray && returning) continue;
          activeSurfaceElements.add(element);
          const kind: TableSurfaceKind = element.matches(".board-wrap") ? "board"
            : element.matches(".floating-reroll-tray, .opening-roll-tray") ? "roll" : "tray";
          const inner = element.querySelector<HTMLElement>(".board-grid")?.getBoundingClientRect();
          const borderWidth = Math.min(parseFloat(style.borderLeftWidth) || 3, parseFloat(style.borderTopWidth) || 3);
          const availableRim = inner
            ? Math.min(inner.left - rect.left, inner.top - rect.top, rect.right - inner.right, rect.bottom - inner.bottom)
            : borderWidth + Math.min(parseFloat(style.paddingLeft) || 0, parseFloat(style.paddingTop) || 0) * 0.65;
          const options = {
            width: rect.width / pixelsPerUnit,
            depth: rect.height / pixelsPerUnit / TABLE_CAMERA_COS,
            kind,
            rimWidth: Math.max(2, availableRim) / pixelsPerUnit
          };
          let surface = surfaces.get(element);
          if (!surface) {
            surface = surfaceFactory.create(options);
            surfaces.set(element, surface);
            scene.add(surface.group);
            lastShadowSignature = "";
          } else if (surface.update(options)) {
            lastShadowSignature = "";
          }
          // Keep the existing maple playing area and accessible DOM grid inside a
          // real raised wooden frame, all under the same camera and lights.
          worldPosition(rect.left + rect.width / 2, rect.top + rect.height / 2, surface.floorY, surface.group.position);
          surface.group.visible = true;
          const active = kind === "board" || Boolean(element.closest(
            ".dice-tray.is-active-player, .opponent-tray-row.is-active-player, .tabletop-tray-slot.is-active"));
          surface.setAccent(active ? style.getPropertyValue(kind === "board" ? "--active-player-color" : "--rail-accent").trim()
            || style.getPropertyValue("--tray-player-color").trim() || null : null);
        }
        for (const [element, surface] of surfaces) {
          if (!activeSurfaceElements.has(element)) {
            surface.dispose();
            surfaces.delete(element);
            lastShadowSignature = "";
          }
        }
        table.visible = !modal;
        table.position.y = TABLE_SURFACE_Y;
        table.scale.set(width / pixelsPerUnit * 1.2, height / pixelsPerUnit / TABLE_CAMERA_COS * 1.2, 1);
        for (const instance of instances.values()) { instance.mesh.visible = false; instance.contact.visible = false; }
        const activeInstances = new Set<object>();
        let renderedAny = false;
        const visibleBadges = new Set<HTMLElement>();
        const visibleLocks = new Set<HTMLElement>();
        for (const target of document.querySelectorAll<HTMLElement>(LIVE_DIE_SELECTOR)) {
          const value = liveDieValue(target);
          const rect = target.getBoundingClientRect();
          if (!value || rect.width < 4 || rect.height < 4 || rect.bottom < 0 || rect.top > height || rect.right < 0 || rect.left > width || modal) continue;
          const style = getComputedStyle(target);
          if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
          const centerX = rect.left + rect.width / 2, centerY = rect.top + rect.height / 2;
          const floating = Boolean(target.closest(".drag-preview, .bot-drag-preview, .invalid-return-preview, .floating-reroll-tray.is-returning"));
          if (!floating && coveredByRoll(rect) && !target.closest(".floating-reroll-tray, .opening-roll-tray")) continue;
          const hit = document.elementFromPoint(Math.max(0, Math.min(width - 1, centerX)), Math.max(0, Math.min(height - 1, centerY)));
          if (!floating && hit && hit !== target && !target.contains(hit) && !hit.contains(target) &&
            !hit.closest(".dice-render-loader, .turn-start-backdrop")) continue;
          const color = target.dataset.liveDieColor as PlayerColor ?? playerColorForOwner(target.dataset.liveDieOwner ?? "p1");
          const instance = getDie(target, color);
          activeInstances.add(target);
          // Size from the actual cell/well, not a board-wide cap that shrinks tray dice.
          const size = Math.max(rect.width, rect.height) / pixelsPerUnit / 1.04;
          const floor = target.closest(".board-wrap, .floating-reroll-tray, .opening-roll-tray") || floating
            ? BOARD_SURFACE_Y : TRAY_SURFACE_Y;
          const lift = presentationHeight(target) - DIE_FLOOR_CENTER_Y;
          const elevation = floor + DIE_FLOOR_CENTER_Y * size + lift * size * 0.65;
          worldPosition(centerX, centerY, elevation, instance.mesh.position);
          instance.mesh.scale.setScalar(size);
          instance.mesh.quaternion.copy(finalDieQuaternion(value, 0, 0));
          const facing = tabletopFacingAngle(target);
          instance.mesh.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -facing));
          positionContact(instance, floor, size);
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


        for (const presentation of liveRolls.values()) {
          if (modal || !presentation.host.isConnected) continue;
          for (const pose of presentation.dice) {
            const screen = rollScreenPosition(presentation, pose.position);
            const size = screen.pixelsPerUnit / pixelsPerUnit;
            const instance = getDie(pose, pose.color);
            activeInstances.add(pose);
            const elevation = BOARD_SURFACE_Y + pose.position.y * size;
            worldPosition(screen.x, screen.y, elevation, instance.mesh.position);
            instance.mesh.quaternion.copy(pose.quaternion);
            instance.mesh.scale.copy(pose.scale).multiplyScalar(size);
            positionContact(instance, BOARD_SURFACE_Y, size);
            renderedAny = true;
          }
        }
        for (const [key, instance] of instances) {
          if (!activeInstances.has(key)) {
            scene.remove(instance.mesh, instance.contact);
            instance.contact.material.dispose();
            instances.delete(key);
          }
        }
        const signature = [...instances.values()].map(({ mesh }) =>
          [...mesh.position.toArray(), ...mesh.quaternion.toArray(), mesh.scale.x].map(v => v.toFixed(3)).join(",")).join("|")
          + [...surfaces.values()].map(({ group }) => group.position.toArray().join(",")).join("|");
        if (signature !== lastShadowSignature) {
          renderer.shadowMap.needsUpdate = true;
          lastShadowSignature = signature;
        }
        renderer.render(scene, camera);
        renderer.domElement.dataset.diceCount = String(instances.size);
        renderer.domElement.dataset.drawCalls = String(renderer.info.render.calls);
        renderer.domElement.dataset.triangles = String(renderer.info.render.triangles);
        if (!ready) {
          ready = true;
          document.documentElement.classList.add("live-dice-3d-ready");
          document.documentElement.classList.remove("dice-3d-unavailable");
          onReady();
        }
      };
      frame = requestAnimationFrame(render);
      const contextLost = (event: Event) => {
        event.preventDefault();
        if (!disposed) document.documentElement.classList.add("dice-3d-unavailable");
      };
      const contextRestored = () => { document.documentElement.classList.remove("dice-3d-unavailable"); lastShadowSignature = ""; };
      renderer.domElement.addEventListener("webglcontextlost", contextLost);
      renderer.domElement.addEventListener("webglcontextrestored", contextRestored);
      cleanup = () => {
        cancelAnimationFrame(frame);
        document.documentElement.classList.remove("live-dice-3d-ready", "live-dice-3d-overlay-ready", "dice-3d-unavailable");
        badgeLayer.remove();
        instances.forEach(({ contact }) => contact.material.dispose());
        palette.dispose();
        contactGeometry.dispose();
        contactTexture.dispose();
        surfaceFactory.dispose();
        table.geometry.dispose();
        shadowMaterial.dispose();
        lighting.dispose();
        renderer.domElement.removeEventListener("webglcontextlost", contextLost);
        renderer.domElement.removeEventListener("webglcontextrestored", contextRestored);
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      };
    }).catch(error => {
      console.error("Unable to load the game dice", error);
      if (!disposed) {
        document.documentElement.classList.add("dice-3d-unavailable");
        onReady();
      }
    });
    return () => { disposed = true; cleanup?.(); };
  }, [onReady]);
  return null;
}
