import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { BOARD_SURFACE_Y, TABLE_SURFACE_Y, TRAY_SURFACE_Y, createTableSurfaceFactory } from "./tableSurfaces";

describe("physical tabletop surfaces", () => {
  beforeEach(() => {
    // Geometry and fallback-material checks do not require a browser or image IO.
    vi.spyOn(THREE.TextureLoader.prototype, "load").mockReturnValue(new THREE.Texture());
  });
  afterEach(() => vi.restoreAllMocks());

  const makeFactory = () => createTableSurfaceFactory({
    capabilities: { getMaxAnisotropy: () => 4 }
  } as unknown as THREE.WebGLRenderer);

  it.each(["board", "tray", "roll"] as const)("keeps %s's playable interior open below a raised rounded rim", kind => {
    const factory = makeFactory();
    const width = 8, depth = kind === "tray" ? 1.6 : 8, rimWidth = 0.16;
    const surface = factory.create({ width, depth, rimWidth, kind });
    surface.group.updateMatrixWorld(true);
    const rim = surface.group.getObjectByName("Rounded maple lip and inside walls") as THREE.Mesh;
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, -1, 0));
    expect(ray.intersectObject(rim)).toHaveLength(0);
    ray.ray.origin.x = width / 2 - rimWidth / 2;
    const edge = ray.intersectObject(rim)[0];
    expect(edge).toBeDefined();
    expect(edge.point.y).toBeGreaterThan(0.16);
    expect(edge.face!.normal.y).toBeGreaterThan(0.8);

    const bounds = new THREE.Box3().setFromObject(surface.group);
    expect(bounds.max.x).toBeLessThanOrEqual(width / 2 + 1e-5);
    expect(bounds.min.x).toBeGreaterThanOrEqual(-width / 2 - 1e-5);
    expect(bounds.max.z).toBeLessThanOrEqual(depth / 2 + 1e-5);
    expect(bounds.min.z).toBeGreaterThanOrEqual(-depth / 2 - 1e-5);
    expect(surface.floorY).toBe(kind === "tray" ? TRAY_SURFACE_Y : BOARD_SURFACE_Y);
    expect(bounds.max.y - bounds.min.y).toBeCloseTo(kind === "tray" ? 0.61 : kind === "roll" ? 0.78 : 0.80);
    expect(bounds.min.y + surface.floorY).toBeGreaterThan(TABLE_SURFACE_Y);
    // An ordinary rounded box is limited by slab thickness and leaves square
    // corner tabs protruding from under the wider-radius ring.
    const base = surface.group.getObjectByName("Solid maple lower skirt") as THREE.Mesh;
    const vertices = base.geometry.getAttribute("position");
    const cornerRadius = kind === "board" ? 0.34 : kind === "tray" ? 0.464 : 0.23;
    for (let i = 0; i < vertices.count; i += 1) {
      const dx = Math.max(0, Math.abs(vertices.getX(i)) - (width / 2 - cornerRadius));
      const dz = Math.max(0, Math.abs(vertices.getZ(i)) - (depth / 2 - cornerRadius));
      expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(cornerRadius + 1e-5);
    }
    factory.dispose();
  });

  it("keeps active lighting local to a surface and preserves it across resizing", () => {
    const factory = makeFactory();
    const spec = { width: 8, depth: 1.6, rimWidth: 0.16, kind: "tray" as const };
    const active = factory.create(spec);
    const inactive = factory.create(spec);
    const band = () => active.group.getObjectByName("Active player LED edge") as THREE.Mesh;
    const rim = (surface: typeof active) => (surface.group.getObjectByName("Rounded maple lip and inside walls") as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(band().visible).toBe(false);
    active.setAccent("#ff3300");
    expect(band().visible).toBe(true);
    expect(rim(active).emissive.getHexString()).toBe("ff3300");
    expect(rim(inactive).emissiveIntensity).not.toBe(0.24);
    active.update({ ...spec, width: 9 });
    expect(band().visible).toBe(true);
    expect(rim(active).emissive.getHexString()).toBe("ff3300");
    active.setAccent("#00cc66");
    expect((band().material as THREE.MeshBasicMaterial).color.getHexString()).toBe("00cc66");
    active.setAccent(null);
    expect(band().visible).toBe(false);
    expect(rim(active).emissiveIntensity).toBe(0);
    factory.dispose();
  });

  it("preserves the DOM floor color and separates shadow receiving from depth occlusion", () => {
    const factory = makeFactory();
    const surface = factory.create({ width: 8, depth: 8, rimWidth: 0.2, kind: "board" });
    const receiver = surface.group.getObjectByName("Transparent playing floor shadow receiver") as THREE.Mesh;
    const occluder = surface.group.getObjectByName("Colorless raised floor occluder") as THREE.Mesh;
    expect(receiver.material).toBeInstanceOf(THREE.ShadowMaterial);
    expect((receiver.material as THREE.Material).depthWrite).toBe(false);
    expect(receiver.position.y).toBe(0);
    expect(occluder.position.y).toBeCloseTo(-0.001);
    expect((occluder.material as THREE.Material).colorWrite).toBe(false);
    expect(occluder.renderOrder).toBeLessThan(receiver.renderOrder);
    const rim = surface.group.children[0] as THREE.Mesh;
    const geometry = rim.geometry;
    const disposed = vi.fn();
    geometry.addEventListener("dispose", disposed);
    expect(surface.update({ width: 8.005, depth: 8, rimWidth: 0.2, kind: "board" })).toBe(false);
    expect(surface.group.children[0]).toBe(rim);
    expect(surface.update({ width: 8.02, depth: 8, rimWidth: 0.2, kind: "board" })).toBe(true);
    expect(disposed).toHaveBeenCalledOnce();
    factory.dispose();
    expect(surface.group.children).toHaveLength(0);
  });
});
