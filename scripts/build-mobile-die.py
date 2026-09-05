"""Blender background export of a bounded mobile LOD from the canonical glTF."""
import bpy
from pathlib import Path
import json
import hashlib

root = Path(__file__).resolve().parents[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root / "public/models/die.glb"))
triangles = 0
for obj in list(bpy.context.scene.objects):
    if obj.type != "MESH":
        continue
    bpy.context.view_layer.objects.active = obj
    modifier = obj.modifiers.new("Mobile cavity-preserving LOD", "DECIMATE")
    modifier.ratio = 0.30
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    normals = obj.modifiers.new("Restore broad face normals after simplification", "WEIGHTED_NORMAL")
    normals.keep_sharp = True
    normals.weight = 50
    bpy.ops.object.modifier_apply(modifier=normals.name)
    obj.data.calc_loop_triangles()
    triangles += len(obj.data.loop_triangles)
    # Keep UVs and cavity normals; remove the extra clearcoat shader on phones.
for material in bpy.data.materials:
    if material.use_nodes:
        for node in material.node_tree.nodes:
            if node.type == "BSDF_PRINCIPLED":
                node.inputs["Coat Weight"].default_value = 0
target = root / "public/models/die-mobile.glb"
bpy.ops.export_scene.gltf(filepath=str(target), export_format="GLB", export_yup=True)
assert 1000 < triangles < 5000, triangles
(root / "art/die-mobile-metadata.json").write_text(json.dumps({
    "triangles": triangles, "sha256": hashlib.sha256(target.read_bytes()).hexdigest()
}, indent=2) + "\n")
print("Mobile die triangles:", triangles)
