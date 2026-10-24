"""Maintainer-only: reproduce checked-in TTFs (requires fonttools[woff]==4.60.1).

Normal SDK builds use the audited files offline and do not need Python.
Run: python scripts/rebuild-font-pack.py --output .build/rebuilt-fonts
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import urllib.request
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, default=Path(".build/rebuilt-fonts"))
args = parser.parse_args()
manifest = json.loads((Path(__file__).resolve().parents[1] / "packages/core/assets/fonts/manifest.json").read_text(encoding="utf-8"))
args.output.mkdir(parents=True, exist_ok=True)
for face in manifest["faces"]:
    with urllib.request.urlopen(face["source"], timeout=30) as response:
        source = response.read(40 * 1024 * 1024)
    assert hashlib.sha256(source).hexdigest() == face["sourceSha256"], "Upstream source mismatch"
    font = TTFont(io.BytesIO(source), recalcTimestamp=False)
    instantiateVariableFont(font, {"wght": face["weight"]}, inplace=True, optimize=True)
    style = "Bold" if face["weight"] == 700 else "Regular"
    family = face["family"]
    names = {1: family, 2: style, 4: family + " " + style, 6: family.replace(" ", "") + "-" + style, 16: family, 17: style}
    for record in font["name"].names:
        if record.nameID in names:
            record.string = names[record.nameID].encode(record.getEncoding())
    destination = args.output / face["file"]
    font.save(destination, reorderTables=True)
    assert hashlib.sha256(destination.read_bytes()).hexdigest() == face["sha256"], "Rebuild mismatch: use fontTools 4.60.1"
    print(face["file"], "reproduced")
