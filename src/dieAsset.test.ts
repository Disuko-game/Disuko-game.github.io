import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createDiePalette } from "./dieAsset";
import metadata from "../art/die-mobile-metadata.json";

describe("mobile 3D dice", () => {
  it("uses a bounded lower-detail asset", () => {
    expect(metadata.triangles).toBeGreaterThan(1000);
    expect(metadata.triangles).toBeLessThan(5000);
  });
  it("keeps geometry and tint but removes layered physical shading", () => {
    const source = new THREE.MeshPhysicalMaterial({ color: "white", clearcoat: 0.32 });
    source.name = "DieBody";
    const geometry = new THREE.BoxGeometry();
    const asset = new THREE.Group();
    asset.add(new THREE.Mesh(geometry, source));
    const palette = createDiePalette(asset, true);
    const die = palette.create("red");
    const mesh = die.children[0] as THREE.Mesh;
    expect(mesh.geometry).toBe(geometry);
    expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(mesh.material).not.toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHexString()).toBe("aa0a12");
    palette.dispose();
    source.dispose();
    geometry.dispose();
  });
});
