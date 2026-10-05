"""Stage 5: how loud each helicopter is, and how many residents hear it.

Each type gets a peak level, LAmax, at 150 m from its certified flyover level.
Below a helicopter, the level at a Census block falls with slant distance:

    L(r) = L150 - 20 log10(r / 150) - absorption * (r - 150)

The model ignores buildings, which both block and reflect sound, and ignores
the way a helicopter is louder ahead of it than behind. Pressure altitude
stands in for height above ground; most of the city sits below 60 m.

Outputs in build/staging/:

    noise_types.json          {type: {lamax150, metric, certified, basis}}
    exposure_2026-08-02.json  per flight and per day, residents by band
    events_2026-08-02.json    per block, how many flights reached each band

Reaching a block once and reaching it 140 times are different burdens. The
event count follows the "number above" metric (N60, N70) used for airport
noise in Australia: the number of flights a place hears above a level in a day.
"""

import importlib
import json
import math
import os
import re
import statistics
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
cfg = importlib.import_module("00_config")

FT = 0.3048
MIN_SLANT_M = 30.0
CELL_DEG = 0.01  # block grid cell, about 1.1 km north-south


# ---------------------------------------------------------------------------
# Reference levels
# ---------------------------------------------------------------------------

def fetch_caadb():
    path = cfg.NOISE / cfg.CAADB_FILE
    if not path.exists():
        cfg.NOISE.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(cfg.CAADB_URL,
                                     headers={"User-Agent": cfg.USER_AGENT})
        with urllib.request.urlopen(req, timeout=cfg.REQUEST_TIMEOUT) as r:
            path.write_bytes(r.read())
    return path


def xlsx_rows(path):
    """Yield each row of the first sheet as {column letter: text}."""
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    with zipfile.ZipFile(path) as z:
        shared = ["".join(t.text or "" for t in si.iter(ns + "t"))
                  for si in ET.fromstring(z.read("xl/sharedStrings.xml"))]
        sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    for row in sheet.iter(ns + "row"):
        out = {}
        for c in row.findall(ns + "c"):
            v = c.find(ns + "v")
            if v is not None:
                col = re.match(r"[A-Z]+", c.get("r")).group()
                out[col] = shared[int(v.text)] if c.get("t") == "s" else v.text
        yield out


def number(text):
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def reference_levels():
    """LAmax at 150 m for each ICAO type, from the median certified level."""
    sel_to_lamax = 10 * math.log10(
        math.pi * cfg.REF_DISTANCE_M / cfg.FLYOVER_SPEED_MS)
    rows = list(xlsx_rows(fetch_caadb()))
    levels = {}
    for code, pattern in cfg.NOISE_TYPES.items():
        sel, epnl = [], []
        for r in rows:
            if re.search(pattern, (r.get("G") or "").strip()):
                if number(r.get("V")):
                    sel.append(number(r["V"]))
                if number(r.get("AC")):
                    epnl.append(number(r["AC"]))
        if sel:
            metric, certified = "SEL", statistics.median(sel)
            as_sel = certified
        elif epnl:
            metric, certified = "EPNL", statistics.median(epnl)
            as_sel = certified - cfg.EPNL_TO_SEL_DB
        else:
            raise ValueError("no certified level for " + code)
        levels[code] = {"lamax150": round(as_sel - sel_to_lamax, 1),
                        "metric": metric, "certified": certified,
                        "records": len(sel) or len(epnl), "basis": code}
    for code, proxy in cfg.NOISE_PROXY.items():
        levels[code or "unknown"] = dict(levels[proxy], basis=proxy)
    return levels


def level_at(lamax150, slant_m):
    r = max(slant_m, MIN_SLANT_M)
    return (lamax150 - 20 * math.log10(r / cfg.REF_DISTANCE_M)
            - cfg.ABSORPTION_DB_PER_KM * (r - cfg.REF_DISTANCE_M) / 1000)


def reach_m(lamax150, floor_db):
    """Slant distance at which the level falls to floor_db."""
    lo, hi = MIN_SLANT_M, 50000.0
    for _ in range(60):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if level_at(lamax150, mid) >= floor_db else (lo, mid)
    return lo


# ---------------------------------------------------------------------------
# Exposure
# ---------------------------------------------------------------------------

class Blocks:
    """Census block points on a grid, so a lookup only checks nearby cells."""

    def __init__(self, rows):
        self.lat = [r[1] for r in rows]
        self.lon = [r[2] for r in rows]
        self.pop = [r[3] for r in rows]
        self.region = [r[4] for r in rows]
        self.grid = defaultdict(list)
        for i, (la, lo) in enumerate(zip(self.lat, self.lon)):
            self.grid[self.cell(la, lo)].append(i)

    @staticmethod
    def cell(lat, lon):
        return int(lat / CELL_DEG), int(lon * cfg.LON_SCALE / CELL_DEG)

    def residents(self, indices):
        """{"all": n, region: n} for a set of block indices."""
        out = dict.fromkeys(["all", *cfg.REGIONS], 0)
        for i in indices:
            out["all"] += self.pop[i]
            out[self.region[i]] += self.pop[i]
        return out

    def near(self, lat, lon, radius_m):
        span = int(radius_m / (CELL_DEG * 111200)) + 1
        ci, cj = self.cell(lat, lon)
        for i in range(ci - span, ci + span + 1):
            for j in range(cj - span, cj + span + 1):
                yield from self.grid.get((i, j), ())


def samples(points, step):
    """Positions every step seconds, interpolated between received points."""
    t = points[0][0]
    k = 0
    while t <= points[-1][0]:
        while points[k + 1][0] < t:
            k += 1
        a, b = points[k], points[k + 1]
        span = b[0] - a[0]
        f = (t - a[0]) / span if span else 0
        yield tuple(a[i] + f * (b[i] - a[i]) for i in (1, 2, 3))
        t += step


def flight_exposure(flight, lamax150, blocks, reach):
    """Peak simultaneous residents and blocks reached, for each band.

    Peak is {"all" or region: [residents per band]}. The "all" peak is the
    largest combined moment, not the sum of the regions' separate peaks.
    """
    bands = cfg.BANDS
    keys = ["all", *cfg.REGIONS]
    peak = {k: [0] * len(bands) for k in keys}
    reached = [dict() for _ in bands]  # block index to its loudest level
    if len(flight["points"]) < 2:
        return peak, reached
    for lat, lon, alt in samples(flight["points"], cfg.STEP_S):
        h = max(alt * FT, 0.0)
        if h >= reach:
            continue
        ground = math.sqrt(reach * reach - h * h)
        now = {k: [0] * len(bands) for k in keys}
        for i in blocks.near(lat, lon, ground):
            dy = (blocks.lat[i] - lat) * 111200
            dx = (blocks.lon[i] - lon) * 111200 * cfg.LON_SCALE
            level = level_at(lamax150, math.sqrt(dx * dx + dy * dy + h * h))
            for b, floor in enumerate(bands):
                if level < floor:
                    break
                now["all"][b] += blocks.pop[i]
                now[blocks.region[i]][b] += blocks.pop[i]
                if level > reached[b].get(i, 0):
                    reached[b][i] = level
        for k in keys:
            peak[k] = [max(p, n) for p, n in zip(peak[k], now[k])]
    return peak, reached


def main():
    levels = reference_levels()
    (cfg.STAGING / "noise_types.json").write_text(json.dumps(levels, indent=1))
    for code in sorted(levels):
        v = levels[code]
        print("      %-7s %5.1f dBA at 150 m  (%s %.1f, n=%d%s)"
              % (code, v["lamax150"], v["metric"], v["certified"], v["records"],
                 "" if v["basis"] == code else ", as " + v["basis"]))

    blocks = Blocks(json.loads((cfg.STAGING / "blocks.json").read_text())["rows"])
    floor = cfg.BANDS[0]
    for day in cfg.DAYS:
        flights = json.loads((cfg.STAGING / ("flights_%s.json" % day)).read_text())
        per_flight = []
        union = defaultdict(lambda: [set() for _ in cfg.BANDS])
        events = {g: [defaultdict(int) for _ in cfg.BANDS]
                  for g in ("all", *cfg.GROUPS)}
        for f in flights:
            ref = levels.get(f["aircraft"]["type"] or "unknown",
                             levels["unknown"])["lamax150"]
            peak, reached = flight_exposure(f, ref, blocks, reach_m(ref, floor))
            counts = [blocks.residents(r) for r in reached]
            per_flight.append({"id": f["id"], "peak": peak,
                               "reached": {k: [c[k] for c in counts]
                                           for k in counts[0]}})
            group = next(g for g, cats in cfg.GROUPS.items()
                         if f["category"] in cats)
            for key in ("all", group, f["category"]):
                for b, r in enumerate(reached):
                    union[key][b].update(r)
            for key in ("all", group):
                for b, r in enumerate(reached):
                    for i in r:
                        events[key][b][i] += 1
        totals = {}
        for key, sets in union.items():
            counts = [blocks.residents(s) for s in sets]
            totals[key] = {k: [c[k] for c in counts] for k in counts[0]}
        (cfg.STAGING / ("exposure_%s.json" % day)).write_text(json.dumps(
            {"bands": cfg.BANDS, "flights": per_flight, "residents": totals},
            separators=(",", ":")))
        write_events(day, blocks, events)
        print("      %s residents reached at %s dBA:"
              % (day, "/".join(map(str, cfg.BANDS))))
        for key in ("all", *cfg.GROUPS):
            print("        %-15s %s" % (key, "   ".join(
                "%s %s" % (r, "/".join(format(n, ",") for n in totals[key][r]))
                for r in totals[key])))


def write_events(day, blocks, events):
    """Event counts by block, and residents by how often they hear flights."""
    out = {}
    for key, per_band in events.items():
        rows = sorted(set().union(*per_band))
        out[key] = [[i] + [per_band[b].get(i, 0) for b in range(len(cfg.BANDS))]
                    for i in rows]
    (cfg.STAGING / ("events_%s.json" % day)).write_text(json.dumps(
        {"bands": cfg.BANDS, "fields": ["block", *("n%d" % b for b in cfg.BANDS)],
         "rows": out}, separators=(",", ":")))
    for band in (60, 70):
        counts = events["all"][cfg.BANDS.index(band)]
        line = ", ".join(
            "%d+ %s" % (k, "/".join(format(v, ",") for v in blocks.residents(
                i for i, n in counts.items() if n >= k).values()))
            for k in cfg.EVENT_STEPS)
        print("      %s N%d residents (all/%s) hearing %s"
              % (day, band, "/".join(cfg.REGIONS), line))


if __name__ == "__main__":
    main()
