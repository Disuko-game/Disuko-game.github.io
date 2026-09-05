import * as THREE from "three";

/** One tabletop light rig, shared by every die and every receiving surface. */
export function createTableLighting(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;

  // Broad windows reflected in the plastic; illumination is never baked into albedo.
  const room = new THREE.Scene();
  const roomMaterials: THREE.Material[] = [];
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const wall = new THREE.MeshBasicMaterial({ color: 0x797066, side: THREE.BackSide });
  roomMaterials.push(wall);
  const enclosure = new THREE.Mesh(geometry, wall);
  enclosure.scale.set(30, 20, 30);
  room.add(enclosure);
  for (const [x, y, z, w, h, d, strength] of [
    [-6, 7, -8, 8, 7, 0.1, 3.5], [8, 6, 2, 0.1, 6, 4, 1.2], [0, 9, 0, 12, 0.1, 10, 0.55]
  ]) {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(strength, strength * 0.97, strength * 0.91) });
    const panel = new THREE.Mesh(geometry, material);
    panel.position.set(x, y, z);
    panel.scale.set(w, h, d);
    room.add(panel);
    roomMaterials.push(material);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(room, 0.06, 0.1, 60, { size: 128 });
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.35;
  roomMaterials.forEach(m => m.dispose());
  geometry.dispose();
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0xfff6e7, 0x74502f, 0.65));
  const key = new THREE.DirectionalLight(0xfff3df, 2.4);
  key.position.set(-8, 18, -12);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.00012;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 4;
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 100;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xcbdcf5, 0.4);
  fill.position.set(7, 9, 6);
  scene.add(fill);

  return {
    key,
    resize(width: number, height: number) {
      const extent = Math.max(width, height) * 0.62 + 4;
      key.shadow.camera.left = key.shadow.camera.bottom = -extent;
      key.shadow.camera.right = key.shadow.camera.top = extent;
      key.shadow.camera.updateProjectionMatrix();
    },
    dispose() { environment.dispose(); key.shadow.dispose(); }
  };
}

/** Restrained contact occlusion, used only while a die is within a few mm of a surface. */
export function createContactTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(32, 32, 16, 32, 32, 32);
  gradient.addColorStop(0, "rgba(0,0,0,0.55)");
  gradient.addColorStop(0.65, "rgba(0,0,0,0.12)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}
