import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { configureTableShadows } from "./tableLighting";

describe("table shadow budget", () => {
  it("disables shadow rendering and casting entirely for mobile", () => {
    const renderer = { shadowMap: { enabled: true, autoUpdate: true, needsUpdate: true } } as THREE.WebGLRenderer;
    const key = new THREE.DirectionalLight();
    configureTableShadows(renderer, key, 0);
    expect(renderer.shadowMap.enabled).toBe(false);
    expect(renderer.shadowMap.needsUpdate).toBe(false);
    expect(renderer.shadowMap.autoUpdate).toBe(false);
    expect(key.castShadow).toBe(false);
    expect(key.shadow.map).toBeNull();
  });
  it("preserves desktop shadow resolution", () => {
    const renderer = { shadowMap: {} } as THREE.WebGLRenderer;
    const key = new THREE.DirectionalLight();
    configureTableShadows(renderer, key, 2048);
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(key.castShadow).toBe(true);
    expect(key.shadow.mapSize.toArray()).toEqual([2048, 2048]);
  });
});
