# Gameplay die asset

`die.blend` is the Blender source scene; `../public/models/die.glb` is the only
runtime asset. `die-preview.png` is a reference render, not a baked game texture.
The studio camera, tabletop, and lights stay in Blender and are not exported.

## Rebuild

The model was generated with official **Blender 4.5.13 LTS**, running headlessly.
The portable installation lives at `.tools/blender/blender-4.5.13-windows-x64/`
(ignored by Git). From the repository root, in PowerShell:

```powershell
& '.\.tools\blender\blender-4.5.13-windows-x64\blender.exe' --background --factory-startup --python scripts/build-die.py
```

The script builds the geometry, bakes a short-range self-occlusion map, packs it
with roughness, exports the GLB, saves the source scene, and renders the preview.
It does not require third-party Blender add-ons or network access.

The portable archive came from
[Blender's official download server](https://download.blender.org/release/Blender4.5/blender-4.5.13-windows-x64.zip).
Its SHA256 was checked against the
[official checksum manifest](https://download.blender.org/release/Blender4.5/blender-4.5.13.sha256):

```text
b5fdf800ce65fa2f209e8f68d02667e4d720fa1c42f247c72d1882ab04decba6
```

## Runtime contract

- Centered at the origin, **1.04 units** wide on every axis. The GLB geometry is
  already Y-up; no corrective root rotation or scale is needed.
- Face values: `+X=3, -X=4, +Y=1, -Y=6, +Z=2, -Z=5`.
- `DieBody`: white, tintable molded plastic. `DiePips`: warm ivory paint within
  actual concave cavities. Tint only the body material.
- **14,270 triangles**, two material primitives, one embedded 512 x 512 texture.
  Reuse geometry and clone materials when distinct player colors are needed.
- The packed texture uses glTF's **R=AO, G=roughness, B=metallic** convention.
  Keep all three channels linear (`NoColorSpace` in Three.js). The GLTFLoader
  sets this and assigns the texture to the relevant material maps automatically.
- The body's map encodes roughness **0.22**, so retain a roughness multiplier of
  **1** when using that map. Clearcoat is 0.32 with roughness 0.16. The ivory pips
  use their own slightly matte roughness of 0.4.
- AO is short-range self-occlusion only, limited to 24% darkening. World lighting,
  reflections, board contact, and shadows from other dice must be calculated in
  the live Three.js scene. There is no directional lighting in the asset.
- Use the simple existing rounded-cuboid physics collider, not this render mesh.

The asset has real spherical pip cuts, subtly bevelled lips, a twelve-segment
body bevel with a **0.205-unit radius**, smooth shading, and area-weighted corner
normals. The broader shoulders and glossy resin finish follow the user's red
physical-dice reference. The procedural
script is the source of truth for changes to proportions and material treatment.
`die-metadata.json` records the generated counts and coordinate contract.

Material export follows the
[Blender glTF exporter documentation](https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html):
Principled BSDF, linear packed texture channels, and the `glTF Material Output`
node group for the occlusion channel. The runtime asset uses ordinary glTF PBR
plus `KHR_materials_clearcoat`, supported by Three.js's GLTFLoader.
