# Reads every AudioProfile and AudioDescription datablock from the decompiled scripts and writes them as JSON.
#
# Usage: python -I scripts/export-audio-profiles.py [path/to/bor-restoration]
# Writes src/game/data/audioProfiles.json.

import glob
import json
import os
import re
import sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
source = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "..", "bor-restoration"))
files = glob.glob(os.path.join(source, "game-files", "bor", "**", "*.cs"), recursive=True)

block_re = re.compile(r"(?:datablock|new) (AudioProfile|AudioDescription)\((\w+)\)\s*\{(.*?)\n\s*\};", re.S)
field_re = re.compile(r"^\s*(\w+)\s*=\s*(.*?);\s*$", re.M)

profiles = {}
descriptions = {}
for path in sorted(files):
    text = open(path, encoding="latin1").read()
    for kind, name, body in block_re.findall(text):
        fields = {}
        for k, v in field_re.findall(body):
            v = v.strip().strip('"')
            try:
                fields[k] = float(v)
            except ValueError:
                fields[k] = v
        (profiles if kind == "AudioProfile" else descriptions)[name] = fields

dest = os.path.join(root, "src", "game", "data", "audioProfiles.json")
with open(dest, "w") as f:
    json.dump({"profiles": profiles, "descriptions": descriptions}, f, indent=1)
print("wrote", dest, len(profiles), "profiles", len(descriptions), "descriptions")
