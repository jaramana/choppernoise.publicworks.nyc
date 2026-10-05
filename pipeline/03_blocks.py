"""Stage 3: residents by Census block, as points.

The 2020 TIGER/Line block file carries each block's population and an internal
point. A city block is small next to a helicopter's sound footprint, so each
block's residents are placed at that point. Only the block table (the .dbf) is
read; the shapes are not needed.

New York City blocks are taken by county. New Jersey blocks are taken when
their point falls inside the flight box, which covers the Hudson waterfront
from Bayonne to Fort Lee and inland past Newark.

Output, build/staging/blocks.json:

    {"fields": ["geoid", "lat", "lon", "pop", "region"], "rows": [...]}

Blocks with no residents are dropped.
"""

import importlib
import json
import os
import struct
import sys
import urllib.request
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
cfg = importlib.import_module("00_config")


def fetch(state, force=False):
    url = cfg.BLOCKS_URL.format(state=state)
    path = cfg.CENSUS / url.rsplit("/", 1)[1]
    if path.exists() and not force:
        return path
    cfg.CENSUS.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": cfg.USER_AGENT})
    with urllib.request.urlopen(req, timeout=cfg.REQUEST_TIMEOUT) as r, \
            open(path, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    return path


def read_dbf(f):
    """Yield each record of a dBase III table as a dict of strings."""
    head = f.read(32)
    count, head_len, rec_len = struct.unpack("<IHH", head[4:12])
    desc = f.read(head_len - 32)
    fields = [(desc[i:i + 11].split(b"\0")[0].decode(), desc[i + 16])
              for i in range(0, len(desc) - 1, 32)]
    for _ in range(count):
        rec = f.read(rec_len)
        pos, row = 1, {}
        for name, size in fields:
            row[name] = rec[pos:pos + size].decode().strip()
            pos += size
        yield row


def in_box(lat, lon):
    b = cfg.BBOX
    return b["south"] <= lat <= b["north"] and b["west"] <= lon <= b["east"]


def main():
    rows = []
    for region, spec in cfg.REGIONS.items():
        path = fetch(spec["state"])
        member = path.name.replace(".zip", ".dbf")
        with zipfile.ZipFile(path) as z, z.open(member) as f:
            for r in read_dbf(f):
                pop = int(r["POP20"])
                lat, lon = float(r["INTPTLAT20"]), float(r["INTPTLON20"])
                keep = (r["COUNTYFP20"] in spec["counties"] if spec["counties"]
                        else in_box(lat, lon))
                if pop and keep:
                    rows.append([r["GEOID20"], lat, lon, pop, region])
    cfg.STAGING.mkdir(parents=True, exist_ok=True)
    out = cfg.STAGING / "blocks.json"
    out.write_text(json.dumps(
        {"fields": ["geoid", "lat", "lon", "pop", "region"], "rows": rows},
        separators=(",", ":")))
    for region, spec in cfg.REGIONS.items():
        mine = [r for r in rows if r[4] == region]
        print("      %s: %d populated blocks, %s residents"
              % (spec["label"], len(mine), format(sum(r[3] for r in mine), ",")))


if __name__ == "__main__":
    main()
