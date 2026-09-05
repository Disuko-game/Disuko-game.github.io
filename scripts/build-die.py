"""Build Disuko's reusable recessed-pip die with Blender 4.5 LTS.

Run from any directory:
  blender --background --factory-startup --python scripts/build-die.py

Exports art/die.blend, public/models/die.glb and an inspectable studio preview.
The mesh is 1.04 units wide and centered at the origin. Exported glTF is Y-up:
+X=3, -X=4, +Y=1, -Y=6, +Z=2, -Z=5. DieBody may be tinted at runtime;
DiePips stays ivory. AO contains only short-range self-occlusion, never light.
"""

import json
import hashlib
import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "art"
MODELS = ROOT / "public" / "models"
SIZE = 1.04
HALF = SIZE / 2
EDGE_BEVEL = 0.205
PIP_RADIUS = 0.116
PIP_DEPTH = 0.041
PIP_SPACING = 0.218
PIP_LAYOUTS = {
    1: [(0, 0)],
    2: [(-1, -1), (1, 1)],
    3: [(-1, -1), (0, 0), (1, 1)],
    4: [(-1, -1), (-1, 1), (1, -1), (1, 1)],
    5: [(-1, -1), (-1, 1), (0, 0), (1, -1), (1, 1)],
    6: [(-1, -1), (-1, 0), (-1, 1), (1, -1), (1, 0), (1, 1)],
}


def srgb_to_linear(value):
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def material(name, color, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = True
    rgba = tuple(srgb_to_linear(c) for c in color) + (1,)
    mat.diffuse_color = rgba
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0
    bsdf.inputs["IOR"].default_value = 1.49
    bsdf.inputs["Coat Weight"].default_value = 0.32
    bsdf.inputs["Coat Roughness"].default_value = 0.16
    return mat


def apply_modifier(obj, modifier):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def three_to_blender(vector):
    # The exporter rotates Blender Z-up to glTF Y-up: (x, y, z) -> (x, z, -y).
    x, y, z = vector
    return Vector((x, -z, y))


def make_die():
    body_mat = material("DieBody", (1, 1, 1), 0.22)
    pip_mat = material("DiePips", (0.96, 0.947, 0.90), 0.4)
    pip_mat.node_tree.nodes.get("Principled BSDF").inputs["Coat Weight"].default_value = 0.035
    bpy.ops.mesh.primitive_cube_add(size=SIZE)
    die = bpy.context.object
    die.name = "Die"
    die.data.name = "RecessedDie"
    die.data.materials.append(body_mat)
    die.data.materials.append(pip_mat)
    bevel = die.modifiers.new("Molded edge radius", "BEVEL")
    bevel.width = EDGE_BEVEL
    bevel.segments = 12
    bevel.affect = "EDGES"
    bevel.harden_normals = True
    apply_modifier(die, bevel)

    # Each sphere really removes material. The concave cut surface is the ivory
    # paint layer; no floating circles, intersecting caps, or bump-map illusion.
    faces = [
        (3, (1, 0, 0), (0, 0, -1), (0, 1, 0)),
        (4, (-1, 0, 0), (0, 0, 1), (0, 1, 0)),
        (1, (0, 1, 0), (1, 0, 0), (0, 0, -1)),
        (6, (0, -1, 0), (1, 0, 0), (0, 0, 1)),
        (2, (0, 0, 1), (1, 0, 0), (0, 1, 0)),
        (5, (0, 0, -1), (-1, 0, 0), (0, 1, 0)),
    ]
    for value, normal, axis_u, axis_v in faces:
        n, u, v = map(three_to_blender, (normal, axis_u, axis_v))
        for index, (px, py) in enumerate(PIP_LAYOUTS[value]):
            center = n * (HALF + PIP_RADIUS - PIP_DEPTH)
            center += (u * px + v * py) * PIP_SPACING
            bpy.ops.mesh.primitive_uv_sphere_add(
                segments=32, ring_count=20, radius=PIP_RADIUS, location=center
            )
            cutter = bpy.context.object
            cutter.name = f"Pip cutter {value}-{index + 1}"
            # A pole aligned with the face normal creates concentric, smooth
            # cavity rings on every face and avoids uneven Boolean cuts.
            cutter.rotation_mode = "QUATERNION"
            cutter.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(n)
            cutter.data.materials.append(body_mat)
            cutter.data.materials.append(pip_mat)
            for polygon in cutter.data.polygons:
                polygon.material_index = 1
            cut = die.modifiers.new(cutter.name, "BOOLEAN")
            cut.operation = "DIFFERENCE"
            cut.solver = "EXACT"
            cut.object = cutter
            apply_modifier(die, cut)
            bpy.data.objects.remove(cutter, do_unlink=True)

    lip = die.modifiers.new("Soft pip lips", "BEVEL")
    lip.width = 0.0045
    lip.segments = 3
    lip.limit_method = "ANGLE"
    lip.angle_limit = math.radians(32)
    lip.harden_normals = True
    lip.material = 0
    apply_modifier(die, lip)
    for polygon in die.data.polygons:
        polygon.use_smooth = True
    normals = die.modifiers.new("Area weighted corner normals", "WEIGHTED_NORMAL")
    normals.keep_sharp = True
    normals.weight = 50
    normals.mode = "FACE_AREA_WITH_ANGLE"
    apply_modifier(die, normals)

    bpy.ops.object.select_all(action="DESELECT")
    die.select_set(True)
    bpy.context.view_layer.objects.active = die
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(68), island_margin=0.022)
    bpy.ops.object.mode_set(mode="OBJECT")
    die["edgeSize"] = SIZE
    die["faceValues"] = "+X=3,-X=4,+Y=1,-Y=6,+Z=2,-Z=5"
    die["surface"] = "True recessed ivory pips, rounded lips, weighted normals"
    return die, (body_mat, pip_mat)


def bake_surface_maps(die, materials):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 32
    scene.cycles.device = "CPU"
    scene.render.bake.margin = 8
    image = bpy.data.images.new("Die ORM", width=512, height=512, alpha=False)
    image.colorspace_settings.name = "Non-Color"
    original_links = []
    for mat in materials:
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        output = nodes.get("Material Output")
        original_links.append(output.inputs["Surface"].links[0].from_socket)
        ao = nodes.new("ShaderNodeAmbientOcclusion")
        ao.inputs["Distance"].default_value = 0.095
        ao.only_local = True
        emission = nodes.new("ShaderNodeEmission")
        links.new(ao.outputs["AO"], emission.inputs["Color"])
        links.new(emission.outputs["Emission"], output.inputs["Surface"])
        target = nodes.new("ShaderNodeTexImage")
        target.image = image
        nodes.active = target
    bpy.ops.object.bake(type="EMIT")
    pixels = list(image.pixels[:])
    # Pack linear AO / roughness / metalness in glTF's R/G/B convention. Limit
    # self-occlusion to 24% so the pips remain readable under real-time shadows.
    for i in range(0, len(pixels), 4):
        x, y = (i // 4) % 512, (i // 4) // 512
        pixels[i] = 0.76 + 0.24 * pixels[i]
        grain = math.sin(x * 1.618 + y * 2.414) * math.sin(x * 0.731 - y * 0.527)
        pixels[i + 1] = 0.22 + grain * 0.007
        pixels[i + 2] = 0
        pixels[i + 3] = 1
    image.pixels[:] = pixels
    image.filepath_raw = str(ART / "die-orm.png")
    image.file_format = "PNG"
    image.save()
    image.pack()

    # This specially named node group is the documented Blender glTF AO hook.
    group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    group.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    for mat, original in zip(materials, original_links):
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        links.new(original, nodes.get("Material Output").inputs["Surface"])
        for node in list(nodes):
            if node.bl_idname in {"ShaderNodeAmbientOcclusion", "ShaderNodeEmission"}:
                nodes.remove(node)
        tex = next(node for node in nodes if node.bl_idname == "ShaderNodeTexImage")
        tex.label = "Short-range cavity AO / subtle molded roughness"
        split = nodes.new("ShaderNodeSeparateColor")
        split.mode = "RGB"
        links.new(tex.outputs["Color"], split.inputs["Color"])
        bsdf = nodes.get("Principled BSDF")
        if mat.name == "DieBody":
            links.new(split.outputs["Green"], bsdf.inputs["Roughness"])
            links.new(split.outputs["Blue"], bsdf.inputs["Metallic"])
        occlusion = nodes.new("ShaderNodeGroup")
        occlusion.node_tree = group
        links.new(split.outputs["Red"], occlusion.inputs["Occlusion"])
    return image


def aim(obj, point):
    obj.rotation_euler = (Vector(point) - obj.location).to_track_quat("-Z", "Y").to_euler()


def make_preview(die, body_material):
    scene = bpy.context.scene
    scene.world.color = (0.13, 0.13, 0.13)
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -HALF - 0.001))
    floor = bpy.context.object
    floor.name = "Preview tabletop - not exported"
    floor.data.materials.append(material("Preview felt", (0.18, 0.25, 0.22), 0.85))
    for name, location, energy, size, color in [
        ("Softbox key", (-3, -4, 6), 430, 4.0, (1, 0.92, 0.81)),
        ("Softbox fill", (4, 1, 3), 260, 3.0, (0.82, 0.91, 1)),
        ("Edge strip", (0, 3, 4), 330, 2.5, (1, 1, 1)),
    ]:
        light_data = bpy.data.lights.new(name, "AREA")
        light_data.energy, light_data.size, light_data.color = energy, size, color
        light = bpy.data.objects.new(name, light_data)
        scene.collection.objects.link(light)
        light.location = location
        aim(light, (0, 0, 0))
    bpy.ops.object.camera_add(location=(2.1, -2.8, 2.25))
    camera = bpy.context.object
    camera.name = "Die material preview"
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 2.25
    aim(camera, (0, 0, -0.07))
    scene.camera = camera
    scene.render.resolution_x = 960
    scene.render.resolution_y = 960
    scene.render.resolution_percentage = 100
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = "AgX"
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(ART / "die-preview.png")
    bsdf = body_material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = tuple(srgb_to_linear(c) for c in (0.52, 0.018, 0.025)) + (1,)
    bpy.ops.wm.save_as_mainfile(filepath=str(ART / "die.blend"))
    bpy.ops.render.render(write_still=True)


def main():
    ART.mkdir(exist_ok=True)
    MODELS.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    die, materials = make_die()
    bake_surface_maps(die, materials)
    bpy.ops.object.select_all(action="DESELECT")
    die.select_set(True)
    bpy.context.view_layer.objects.active = die
    bpy.ops.export_scene.gltf(
        filepath=str(MODELS / "die.glb"), export_format="GLB",
        use_selection=True, export_yup=True, export_apply=True,
        export_normals=True, export_texcoords=True, export_materials="EXPORT",
        export_extras=True, export_cameras=False, export_lights=False,
    )
    die.data.calc_loop_triangles()
    summary = {
        "blender": bpy.app.version_string,
        "glb": "public/models/die.glb",
        "sha256": hashlib.sha256((MODELS / "die.glb").read_bytes()).hexdigest(),
        "size": list(die.dimensions),
        "triangles": len(die.data.loop_triangles),
        "vertices": len(die.data.vertices),
        "edgeBevel": EDGE_BEVEL,
        "bodyRoughness": 0.22,
        "pipCavities": sum(len(pips) for pips in PIP_LAYOUTS.values()),
        "materials": [mat.name for mat in materials],
        "faceValues": {"+X": 3, "-X": 4, "+Y": 1, "-Y": 6, "+Z": 2, "-Z": 5},
    }
    (ART / "die-metadata.json").write_text(json.dumps(summary, indent=2) + "\n")
    print("DISUKO_DIE " + json.dumps(summary), flush=True)
    make_preview(die, materials[0])


if __name__ == "__main__":
    main()
