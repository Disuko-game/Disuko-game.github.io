import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { PlayerColor } from "./game/types";
import dieMetadata from "../art/die-metadata.json";

const PIGMENTS: Record<PlayerColor, string> = {
  blue: "#075eb2", red: "#aa0a12", green: "#078339", yellow: "#dca313"
};
let assetPromise: Promise<THREE.Group> | undefined;

export function loadDieAsset(): Promise<THREE.Group> {
  assetPromise ??= new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/die.glb?v=${dieMetadata.sha256.slice(0, 16)}`)
    .then(({ scene }) => scene)
    .catch((error) => { assetPromise = undefined; throw error; });
  return assetPromise;
}

/** Geometry and texture data are shared; each color uses one material palette. */
export function createDiePalette(asset: THREE.Group) {
  const palettes = new Map<PlayerColor, Map<THREE.Material, THREE.Material>>();
  const materials: THREE.Material[] = [];
  for (const color of Object.keys(PIGMENTS) as PlayerColor[]) {
    const palette = new Map<THREE.Material, THREE.Material>();
    asset.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const source of Array.isArray(object.material) ? object.material : [object.material]) {
        if (palette.has(source)) continue;
        const material = source.clone() as THREE.MeshStandardMaterial;
        if (/DieBody/i.test(source.name)) material.color.set(PIGMENTS[color]);
        material.envMapIntensity = 0.65;
        material.aoMapIntensity = 0.5;
        material.side = THREE.FrontSide;
        palette.set(source, material);
        materials.push(material);
      }
    });
    palettes.set(color, palette);
  }
  return {
    create(color: PlayerColor): THREE.Group {
      const die = asset.clone(true);
      const palette = palettes.get(color)!;
      die.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.material = Array.isArray(object.material)
          ? object.material.map((material) => palette.get(material)!)
          : palette.get(object.material)!;
        object.castShadow = true;
        object.receiveShadow = true;
      });
      return die;
    },
    dispose: () => materials.forEach((material) => material.dispose())
  };
}
