"""Stage 6: write the files the map reads, in docs/data/.

The browser replays each flight and counts the residents under it as it moves,
so it needs three things: the flights, the Census block points, and the noise
model's constants. The model itself lives in stage 5; the browser repeats only
its one-line level formula and the distances published here.

Outputs in docs/data/:

    meta.json                 days, bands, model constants, types and names
    blocks.json               block points and residents, NYC then New Jersey
    day-2026-08-02.json       flights on a 10-second clock, with stage 5 totals
    events-2026-08-02.json    flights heard per block, loaded for the day view

Paths are resampled to the same 10-second step that stage 5 uses, aligned to
local midnight so every flight shares one clock. Coordinates are integers in
units of 1e-5 degrees (about a metre), each after the first written as the
change from the one before.
"""

import importlib
import json
import math
import os
import sys
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
cfg = importlib.import_module("00_config")
noise = importlib.import_module("05_noise")
extract = importlib.import_module("02_extract")

SCALE = 100000
EVENT_BANDS = [60, 70, 80]  # per-block counts for the day view's dots and the block card


def write(name, obj):
    cfg.SITE_DATA.mkdir(parents=True, exist_ok=True)
    path = cfg.SITE_DATA / name
    path.write_text(json.dumps(obj, separators=(",", ":")))
    return path.stat().st_size


def grid_samples(points, start, step, n_steps):
    """Positions at start + k * step, for every k inside the flight."""
    first = max(math.ceil((points[0][0] - start) / step), 0)
    last = min(math.floor((points[-1][0] - start) / step), n_steps - 1)
    out, j = [], 0
    for k in range(first, last + 1):
        t = start + k * step
        while j + 1 < len(points) - 1 and points[j + 1][0] < t:
            j += 1
        a, b = points[j], points[j + 1]
        span = b[0] - a[0]
        f = min(max((t - a[0]) / span, 0), 1) if span else 0
        out.append(tuple(a[i] + f * (b[i] - a[i]) for i in (1, 2, 3)))
    return first, out


def encode(samples):
    """[lat, lon, alt, dlat, dlon, dalt, ...] in 1e-5 degrees and feet."""
    flat, prev = [], (0, 0, 0)
    for lat, lon, alt in samples:
        cur = (round(lat * SCALE), round(lon * SCALE), round(alt))
        flat.extend(c - p for c, p in zip(cur, prev))
        prev = cur
    return flat


def heard(per_group, pop, region):
    """Residents hearing at least k flights, for each group, band and k."""
    out = {}
    for group, bands in per_group.items():
        out[group] = {}
        for band, counts in bands.items():
            out[group][band] = {}
            for k in cfg.EVENT_STEPS:
                tally = dict.fromkeys(["all", *cfg.REGIONS], 0)
                for i, n in enumerate(counts):
                    if n >= k:
                        tally["all"] += pop[i]
                        tally[region[i]] += pop[i]
                out[group][band][str(k)] = tally
    return out


def main():
    sizes = {}
    levels = json.loads((cfg.STAGING / "noise_types.json").read_text())
    types = {}
    for code, v in levels.items():
        types[code] = {
            "l150": v["lamax150"],
            "reach": [round(noise.reach_m(v["lamax150"], b)) for b in cfg.BANDS],
            "basis": v["basis"],
        }

    rows = json.loads((cfg.STAGING / "blocks.json").read_text())["rows"]
    order = list(cfg.REGIONS)
    if [r[4] for r in rows] != sorted((r[4] for r in rows), key=order.index):
        raise ValueError("blocks.json is not grouped by region")
    spans, i = {}, 0
    for reg in order:
        n = sum(1 for r in rows if r[4] == reg)
        spans[reg] = [i, i + n]
        i += n
    lat0, lon0 = cfg.BBOX["south"], cfg.BBOX["west"]
    sizes["blocks.json"] = write("blocks.json", {
        "scale": SCALE, "lat0": lat0, "lon0": lon0,
        "lat": [round((r[1] - lat0) * SCALE) for r in rows],
        "lon": [round((r[2] - lon0) * SCALE) for r in rows],
        "pop": [r[3] for r in rows],
        "regions": spans,
    })
    pop = [r[3] for r in rows]
    region = [r[4] for r in rows]

    days = []
    for day in cfg.DAYS:
        start, end = (int(t) for t in extract.local_window(day))
        n_steps = (end - start) // cfg.STEP_S

        flights = json.loads((cfg.STAGING / ("flights_%s.json" % day)).read_text())
        exposure = json.loads((cfg.STAGING / ("exposure_%s.json" % day)).read_text())
        coverage = json.loads((cfg.STAGING / ("coverage_%s.json" % day)).read_text())
        by_id = {e["id"]: e for e in exposure["flights"]}

        # No registration, owner or transponder address leaves the pipeline:
        # each flight is numbered within its day, since a US address maps
        # straight to a tail number.
        out = []
        for f in flights:
            k0, samples = grid_samples(f["points"], start, cfg.STEP_S, n_steps)
            if len(samples) < 2:
                continue
            a = f["aircraft"]
            e = by_id[f["id"]]
            out.append({
                "id": "f%d" % len(out), "cat": f["category"], "type": a["type"],
                "seats": a["seats"], "riders": a["riders_max"],
                "k0": k0, "p": encode(samples),
                "peak": e["peak"]["all"], "reached": e["reached"],
            })

        # Residents by flights heard are summed at every band; the browser
        # gets per-block counts only at the bands it draws.
        events = json.loads((cfg.STAGING / ("events_%s.json" % day)).read_text())
        dense = {}
        for group, table in events["rows"].items():
            dense[group] = {str(b): [0] * len(rows) for b in cfg.BANDS}
            for row in table:
                for i, b in enumerate(cfg.BANDS):
                    dense[group][str(b)][row[0]] = row[1 + i]
        per_block = {group: {str(b): bands[str(b)] for b in EVENT_BANDS}
                     for group, bands in dense.items()}

        weekday = date.fromisoformat(day).strftime("%A")
        sizes["day-%s.json" % day] = write("day-%s.json" % day, {
            "day": day, "weekday": weekday, "start": start, "steps": n_steps,
            "hours": coverage["positions_by_hour"], "gaps": coverage["gaps"],
            "flights": out, "residents": exposure["residents"],
            "heard": heard(dense, pop, region),
        })
        sizes["events-%s.json" % day] = write("events-%s.json" % day, per_block)
        days.append({"day": day, "weekday": weekday, "flights": len(out)})

    sizes["meta.json"] = write("meta.json", {
        "built": datetime.now().date().isoformat(),
        "days": days,
        "step": cfg.STEP_S,
        "bands": cfg.BANDS,
        "event_bands": EVENT_BANDS,
        "event_steps": cfg.EVENT_STEPS,
        "groups": cfg.GROUPS,
        "regions": {k: v["label"] for k, v in cfg.REGIONS.items()},
        "model": {"ref_m": cfg.REF_DISTANCE_M,
                  "absorption_db_per_km": cfg.ABSORPTION_DB_PER_KM,
                  "min_slant_m": noise.MIN_SLANT_M, "m_per_deg": 111200,
                  "lon_scale": cfg.LON_SCALE, "cell_deg": noise.CELL_DEG},
        "types": types,
        "names": cfg.TYPE_NAMES,
        "bbox": cfg.BBOX,
    })
    for name, size in sizes.items():
        print("      %-24s %6.0f KB" % (name, size / 1024))


if __name__ == "__main__":
    main()
