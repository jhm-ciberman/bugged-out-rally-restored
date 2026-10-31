# Reads the car, tire and spring datablocks from the decompiled bor/server/scripts/deathcar.cs,
# plus which tire and spring each car fits in its onAdd, and writes them as JSON.
#
# Usage: python -I scripts/export-vehicle-datablocks.py [path/to/bor-restoration]
# Writes src/game/data/vehicleDatablocks.json.

import json
import os
import re
import sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
source = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "..", "bor-restoration"))
text = open(os.path.join(source, "game-files", "bor", "server", "scripts", "deathcar.cs"), encoding="latin1").read()

block_re = re.compile(r"datablock (\w+)\((\w+)\)\s*\{(.*?)\n\};", re.S)
field_re = re.compile(r"^\s*(\w+(?:\[\w+\])?)\s*=\s*(.*?);\s*$", re.M)


def value(raw):
    raw = raw.strip()
    if raw.startswith('"'):
        raw = raw[1:-1]
        parts = raw.split()
        try:
            nums = [float(p) for p in parts]
            return nums if len(nums) > 1 else nums[0]
        except ValueError:
            return raw
    try:
        return float(raw)
    except ValueError:
        return raw


blocks = {}
for kind, name, body in block_re.findall(text):
    if kind in ("WheeledVehicleData", "WheeledVehicleTire", "WheeledVehicleSpring"):
        blocks[name] = {"kind": kind, **{k: value(v) for k, v in field_re.findall(body)}}

cars = {}
for name, data in blocks.items():
    if data["kind"] != "WheeledVehicleData":
        continue
    m = re.search(r"function %s::onAdd\(.*?\n\}" % name, text, re.S)
    body = m.group(0)
    tires = re.findall(r"setWheelTire\(%i, (\w+)\)", body)
    springs = re.findall(r"setWheelSpring\(%i, (\w+)\)", body)
    # Either one tire for every wheel, or "if (%i < 2) front else rear".
    front = tires[0]
    rear = tires[1] if len(tires) > 1 else tires[0]
    cars[name] = {**data, "frontTire": front, "rearTire": rear, "spring": springs[0]}

out = {
    "cars": cars,
    "tires": {k: v for k, v in blocks.items() if v["kind"] == "WheeledVehicleTire"},
    "springs": {k: v for k, v in blocks.items() if v["kind"] == "WheeledVehicleSpring"},
}
dest = os.path.join(root, "src", "game", "data", "vehicleDatablocks.json")
with open(dest, "w") as f:
    json.dump(out, f, indent=1)
print("wrote", dest, "cars:", list(cars))
