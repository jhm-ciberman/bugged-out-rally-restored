# Extracts what the car physics needs from the original .dts files: node positions
# (hubs, eye, cam, mounts), the shape bounds and the collision hull points.
#
# Usage: python -I scripts/export-vehicle-shapes.py [path/to/bor-restoration]
# Writes src/game/data/vehicleShapes.json.

import json
import os
import sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
source = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "..", "bor-restoration"))
sys.path.insert(0, os.path.join(source, "tools", "dts"))

from DtsShape import DtsShape  # noqa: E402

CAR_DIR = os.path.join(source, "game-files", "bor", "data", "shapes", "car")
CARS = ["beetle", "ladybug", "cockroach", "grasshopper", "hornet", "prayingmantis", "scorpion", "blackwidow"]
WHEELS = ["smwheel", "medwheel", "medskinnywheel", "bigwheel", "medwheel_inv", "wheel"]


def load(name):
    shape = DtsShape()
    with open(os.path.join(CAR_DIR, name + ".dts"), "rb") as fd:
        shape.load(fd)
    return shape


def rotate(q, v):
    return q.to_matrix() * v


def node_world(shape, index):
    # Node transforms are translation + rotation relative to the parent.
    pos = shape.default_translations[index]
    parent = shape.nodes[index].parent
    while parent != -1:
        pos = rotate(shape.default_rotations[parent], pos) + shape.default_translations[parent]
        parent = shape.nodes[parent].parent
    return pos


def node_rotate(shape, index, v):
    # Rotates an object-space vector by the node and all its parents.
    while index != -1:
        v = rotate(shape.default_rotations[index], v)
        index = shape.nodes[index].parent
    return v


def vec(v):
    return [round(v.x, 5), round(v.y, 5), round(v.z, 5)]


def export_car(name):
    shape = load(name)
    names = shape.names
    nodes = {}
    for i, node in enumerate(shape.nodes):
        nodes[names[node.name]] = vec(node_world(shape, i))

    hull = []
    for detail in shape.detail_levels:
        if names[detail.name].lower().startswith("collision"):
            od = detail.objectDetail
            for obj in shape.objects:
                if od >= obj.numMeshes:
                    continue
                mesh = shape.meshes[obj.firstMesh + od]
                if not mesh.verts:
                    continue
                offset = node_world(shape, obj.node)
                for v in mesh.verts:
                    hull.append(vec(node_rotate(shape, obj.node, v) + offset))
            break

    return {
        "nodes": nodes,
        "bounds": {"min": vec(shape.bounds.min), "max": vec(shape.bounds.max)},
        "center": vec(shape.center),
        "radius": round(shape.radius, 5),
        "collisionHull": hull,
    }


def export_wheel(name):
    shape = load(name)
    return {"bounds": {"min": vec(shape.bounds.min), "max": vec(shape.bounds.max)}}


out = {"cars": {c: export_car(c) for c in CARS}, "wheels": {w: export_wheel(w) for w in WHEELS}}
dest = os.path.join(root, "src", "game", "data", "vehicleShapes.json")
os.makedirs(os.path.dirname(dest), exist_ok=True)
with open(dest, "w") as f:
    json.dump(out, f, indent=1)
print("wrote", dest)
