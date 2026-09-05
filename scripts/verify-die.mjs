import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const bytes = readFileSync(new URL("../public/models/die.glb", import.meta.url));
const metadata = JSON.parse(readFileSync(new URL("../art/die-metadata.json", import.meta.url), "utf8"));
assert.equal(bytes.toString("ascii", 0, 4), "glTF");
assert.equal(bytes.readUInt32LE(4), 2);
assert.equal(createHash("sha256").update(bytes).digest("hex"), metadata.sha256, "Rebuild the asset metadata/cache key with Blender");
assert.ok(bytes.length < 750_000, "Keep the mobile model compact");
const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8"));
const body = gltf.materials.find(material => material.name === "DieBody");
const pips = gltf.materials.find(material => material.name === "DiePips");
assert.ok(body && pips);
assert.equal(body.pbrMetallicRoughness.roughnessFactor ?? 1, 1);
assert.ok(body.pbrMetallicRoughness.metallicRoughnessTexture && body.occlusionTexture);
assert.ok(Math.abs(pips.pbrMetallicRoughness.roughnessFactor - 0.4) < 0.001);
assert.ok(gltf.images.every(image => image.bufferView !== undefined && !image.uri));
for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
  assert.notEqual(primitive.attributes.NORMAL, undefined);
  assert.notEqual(primitive.attributes.TEXCOORD_0, undefined);
}
console.log(`Verified Blender die: ${bytes.length} bytes; embedded PBR maps, normals, materials and cache hash match.`);
