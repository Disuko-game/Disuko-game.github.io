import * as THREE from "three";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type TableSurfaceKind = "board" | "tray" | "roll";

export const BOARD_SURFACE_Y = 0.48;
export const TRAY_SURFACE_Y = 0.30;
export const TABLE_SURFACE_Y = -0.20;

const BOARD_BODY_DEPTH = 0.58;
const TRAY_BODY_DEPTH = 0.43;

export interface TableSurfaceOptions {
  /** Outer dimensions; the whole rim fits inside this footprint. */
  width: number;
  depth: number;
  kind: TableSurfaceKind;
  /** Available border/padding, measured by the caller outside the playable area. */
  rimWidth: number;
}

export interface TableSurface {
  /** Origin is the center of the playing floor, with Y up. */
  group: THREE.Group;
  readonly floorY: number;
  /** Rebuilds only when a dimension changes by at least 0.01 world units. */
  update(options: TableSurfaceOptions): boolean;
  setAccent(color: string | null): void;
  dispose(): void;
}

const CORNER_SEGMENTS = 8;

function roundedLoop(width: number, depth: number, radius: number): THREE.Vector2[] {
  const r = Math.min(Math.max(0.001, radius), width / 2, depth / 2);
  const points: THREE.Vector2[] = [];
  for (let corner = 0; corner < 4; corner += 1) {
    const cx = (corner === 0 || corner === 3 ? 1 : -1) * (width / 2 - r);
    const cz = (corner < 2 ? 1 : -1) * (depth / 2 - r);
    for (let step = 0; step <= CORNER_SEGMENTS; step += 1) {
      const angle = (corner + step / CORNER_SEGMENTS) * Math.PI / 2;
      points.push(new THREE.Vector2(cx + Math.cos(angle) * r, cz + Math.sin(angle) * r));
    }
  }
  return points;
}

function dimensions(options: TableSurfaceOptions) {
  const width = Math.max(0.08, Number.isFinite(options.width) ? options.width : 0.08);
  const depth = Math.max(0.08, Number.isFinite(options.depth) ? options.depth : 0.08);
  const rimWidth = Math.min(Math.max(0.008, options.rimWidth || 0.008), Math.min(width, depth) * 0.24);
  const radius = Math.min(Math.min(width, depth) * (options.kind === "tray" ? 0.29 : 0.17), options.kind === "board" ? 0.34 : 0.48);
  return { width, depth, rimWidth, radius, kind: options.kind };
}

/** A closed rounded rectangular ring, including the inside walls and lower skirt. */
function rimGeometry(options: ReturnType<typeof dimensions>): THREE.BufferGeometry {
  const { width, depth, rimWidth, radius, kind } = options;
  const lipHeight = kind === "tray" ? 0.18 : kind === "roll" ? 0.20 : 0.22;
  const bodyDepth = kind === "tray" ? TRAY_BODY_DEPTH : BOARD_BODY_DEPTH;
  const bevel = Math.min(rimWidth * 0.26, 0.055);
  const baseBevel = Math.min(0.035, rimWidth * 0.28);
  const profile: Array<[number, number]> = [
    [baseBevel, -bodyDepth], [0, -bodyDepth + baseBevel], [0, lipHeight - bevel]
  ];
  // Quarter-circle shoulders create moving highlights across a truly rounded lip.
  for (let step = 1; step <= 4; step += 1) {
    const angle = step * Math.PI / 8;
    profile.push([bevel * (1 - Math.cos(angle)), lipHeight - bevel + bevel * Math.sin(angle)]);
  }
  profile.push([rimWidth - bevel, lipHeight]);
  for (let step = 1; step <= 4; step += 1) {
    const angle = step * Math.PI / 8;
    profile.push([rimWidth - bevel + bevel * Math.sin(angle), lipHeight - bevel + bevel * Math.cos(angle)]);
  }
  profile.push([rimWidth, 0.012], [rimWidth, -bodyDepth]);

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const count = (CORNER_SEGMENTS + 1) * 4;
  for (const [inset, y] of profile) {
    for (const point of roundedLoop(width - inset * 2, depth - inset * 2, Math.max(0.008, radius - inset))) {
      positions.push(point.x, y, point.y);
      // Keep the existing maple grain at a consistent scale on both top and sides.
      uvs.push(point.x / Math.max(width, 4) + 0.5, point.y / Math.max(depth, 4) + y * 0.42 + 0.5);
    }
  }
  for (let ring = 0; ring < profile.length; ring += 1) {
    const nextRing = (ring + 1) % profile.length;
    for (let i = 0; i < count; i += 1) {
      const next = (i + 1) % count;
      const a = ring * count + i, b = ring * count + next;
      const c = nextRing * count + i, d = nextRing * count + next;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function floorGeometry(options: ReturnType<typeof dimensions>): THREE.ShapeGeometry {
  const inset = options.rimWidth;
  const points = roundedLoop(options.width - inset * 2, options.depth - inset * 2,
    Math.max(0.008, options.radius - inset));
  const shape = new THREE.Shape(points);
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function baseGeometry(options: ReturnType<typeof dimensions>): THREE.BufferGeometry {
  const { width, depth, radius, kind } = options;
  const slabHeight = 0.28;
  const inset = Math.min(0.012, Math.min(width, depth) * 0.035);
  const bevel = Math.min(0.006, Math.min(width, depth) * 0.025);
  // The horizontal corner radius follows the rim, independent of slab height.
  // Account for outward bevel expansion so every layer stays inside that outline.
  const shapeInset = inset + bevel;
  const shape = new THREE.Shape(roundedLoop(width - shapeInset * 2, depth - shapeInset * 2,
    Math.max(0.001, radius - shapeInset)));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: slabHeight - bevel * 2, steps: 1,
    bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -(kind === "tray" ? TRAY_BODY_DEPTH : BOARD_BODY_DEPTH) + bevel, 0);
  const positions = geometry.getAttribute("position");
  const uvs = geometry.getAttribute("uv");
  for (let i = 0; i < positions.count; i += 1) {
    uvs.setXY(i, positions.getX(i) / Math.max(width, 4) + 0.5,
      positions.getZ(i) / Math.max(depth, 4) + positions.getY(i) * 0.42 + 0.5);
  }
  return toCreasedNormals(geometry, Math.PI / 3);
}

/** Shared maple texture/materials and individually disposable surface geometry. */
export function createTableSurfaceFactory(renderer: THREE.WebGLRenderer) {
  let disposed = false;
  const ownedSurfaces = new Set<TableSurface>();
  const materials = new Map<TableSurfaceKind, { rim: THREE.MeshPhysicalMaterial; base: THREE.MeshPhysicalMaterial }>();
  for (const kind of ["board", "tray", "roll"] as const) {
    materials.set(kind, {
      rim: new THREE.MeshPhysicalMaterial({
        color: kind === "tray" ? 0xf0d3a4 : 0xbd9469,
        roughness: 0.46, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.36, bumpScale: 0.010,
        envMapIntensity: 0.45
      }),
      base: new THREE.MeshPhysicalMaterial({
        color: 0x95653c,
        roughness: 0.49, metalness: 0, clearcoat: 0.09, clearcoatRoughness: 0.38, bumpScale: 0.008,
        envMapIntensity: 0.32
      })
    });
  }
  const shadowMaterial = new THREE.ShadowMaterial({
    color: 0x34251a, opacity: 0.35, transparent: true, depthWrite: false
  });
  const depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true });
  let woodTexture: THREE.Texture | undefined;
  new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/pale-maple-board.png`, texture => {
    if (disposed) { texture.dispose(); return; }
    woodTexture = texture;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    for (const { rim, base } of materials.values()) {
      rim.map = base.map = texture;
      rim.bumpMap = base.bumpMap = texture;
      rim.needsUpdate = base.needsUpdate = true;
    }
    for (const surface of ownedSurfaces) {
      const rim = surface.group.getObjectByName("Rounded maple lip and inside walls") as THREE.Mesh;
      const material = rim.material as THREE.MeshPhysicalMaterial;
      material.map = material.bumpMap = texture;
      material.needsUpdate = true;
    }
    // Materials already provide a warm maple fallback if the optional texture fails.
  }, undefined, () => {});

  const create = (initial: TableSurfaceOptions): TableSurface => {
    const group = new THREE.Group();
    group.name = `Physical ${initial.kind} surface`;
    let current: ReturnType<typeof dimensions> | undefined;
    let isDisposed = false;
    let accent: string | null = null;
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff, toneMapped: false, polygonOffset: true,
      polygonOffsetFactor: -2, polygonOffsetUnits: -2
    });
    const litRimMaterial = materials.get(initial.kind)!.rim.clone();
    const clearGeometry = () => {
      for (const child of [...group.children]) {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
        group.remove(child);
      }
    };
    const surface: TableSurface = {
      group,
      get floorY() { return current?.kind === "tray" ? TRAY_SURFACE_Y : BOARD_SURFACE_Y; },
      update(options) {
        if (isDisposed || disposed) return false;
        const next = dimensions(options);
        if (current && current.kind === next.kind &&
          Math.abs(current.width - next.width) < 0.01 &&
          Math.abs(current.depth - next.depth) < 0.01 &&
          Math.abs(current.rimWidth - next.rimWidth) < 0.01) return false;
        clearGeometry();
        current = next;
        const palette = materials.get(next.kind)!;
        litRimMaterial.copy(palette.rim);
        if (accent) { litRimMaterial.emissive.set(accent); litRimMaterial.emissiveIntensity = 0.24; }
        const rim = new THREE.Mesh(rimGeometry(next), litRimMaterial);
        rim.name = "Rounded maple lip and inside walls";
        rim.castShadow = rim.receiveShadow = true;
        group.add(rim);

        const base = new THREE.Mesh(baseGeometry(next), palette.base);
        base.name = "Solid maple lower skirt";
        base.castShadow = base.receiveShadow = true;
        group.add(base);

        const floor = floorGeometry(next);
        const depth = new THREE.Mesh(floor, depthMaterial);
        depth.name = "Colorless raised floor occluder";
        // Write before opaque skirts and transparent shadows. A real separation
        // prevents coplanar depth striping while masking the lower table shadow.
        depth.position.y = -0.001;
        depth.renderOrder = -100;
        group.add(depth);
        const receiver = new THREE.Mesh(floor.clone(), shadowMaterial);
        receiver.name = "Transparent playing floor shadow receiver";
        receiver.receiveShadow = true;
        group.add(receiver);
        const bandGeometry = rimGeometry({ ...next, rimWidth: 0.018 });
        const bandPositions = bandGeometry.getAttribute("position");
        const range = (next.kind === "tray" ? TRAY_BODY_DEPTH + 0.18 : BOARD_BODY_DEPTH + (next.kind === "roll" ? 0.20 : 0.22));
        for (let i = 0; i < bandPositions.count; i++) {
          bandPositions.setY(i, -0.11 + (bandPositions.getY(i) + (next.kind === "tray" ? TRAY_BODY_DEPTH : BOARD_BODY_DEPTH)) / range * 0.035);
        }
        bandGeometry.computeBoundingSphere();
        const band = new THREE.Mesh(bandGeometry, glowMaterial);
        band.name = "Active player LED edge";
        band.visible = Boolean(accent);
        group.add(band);
        return true;
      },
      setAccent(color) {
        if (color === accent) return;
        accent = color;
        const band = group.getObjectByName("Active player LED edge");
        if (band) band.visible = Boolean(color);
        glowMaterial.color.set(color || 0xffffff);
        litRimMaterial.emissive.set(color || 0x000000);
        litRimMaterial.emissiveIntensity = color ? 0.24 : 0;
      },
      dispose() {
        if (isDisposed) return;
        isDisposed = true;
        clearGeometry();
        glowMaterial.dispose();
        litRimMaterial.dispose();
        group.removeFromParent();
        ownedSurfaces.delete(surface);
      }
    };
    ownedSurfaces.add(surface);
    surface.update(initial);
    return surface;
  };

  return {
    create,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const surface of [...ownedSurfaces]) surface.dispose();
      for (const { rim, base } of materials.values()) { rim.dispose(); base.dispose(); }
      shadowMaterial.dispose();
      depthMaterial.dispose();
      woodTexture?.dispose();
    }
  };
}
