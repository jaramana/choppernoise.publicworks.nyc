"""Stage 2: pull NYC helicopter tracks out of the worldwide archives.

The archive is a tar of one gzipped JSON trace per aircraft. It is streamed,
never unpacked, so a 3.6 GB day needs no extra disk. A trace is kept when the
aircraft is a helicopter and at least one point falls inside the city box,
below the altitude ceiling, within the local day.

Output, one file per local day, in build/staging/:

    tracks_2026-08-02.json   [{hex, reg, type, desc, owner, flags, points}]

    coverage_2026-08-02.json [aircraft positions sampled per local hour]

Each point is [unix seconds, lat, lon, altitude ft]. Ground points are 0 ft.

Coverage counts every aircraft, not only helicopters, from a sample of traces.
An hour with no aircraft at all over the city means the archive has a gap, not
that the sky was empty. Those hours are reported and recorded.
"""

import gzip
import importlib
import io
import json
import os
import sys
import tarfile
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
cfg = importlib.import_module("00_config")

STALE = 1  # readsb trace flag for a position carried forward, not received


class Parts(io.RawIOBase):
    """Read split archive parts as one stream."""

    def __init__(self, paths):
        self.files = [open(p, "rb") for p in paths]

    def readable(self):
        return True

    def readinto(self, buf):
        while self.files:
            n = self.files[0].readinto(buf)
            if n:
                return n
            self.files.pop(0).close()
        return 0


def local_window(day):
    tz = ZoneInfo(cfg.TIMEZONE)
    start = datetime.combine(date.fromisoformat(day), time(0), tz)
    return start.timestamp(), (start + timedelta(days=1)).timestamp()


def is_helicopter(trace):
    """The type designator decides. Category is a fallback for untyped
    aircraft, because some airplane transponders misreport A7."""
    if trace.get("t"):
        return trace["t"] in cfg.HELICOPTER_TYPES
    for p in trace["trace"]:
        info = p[8] if len(p) > 8 else None
        if info and info.get("category") == cfg.ROTORCRAFT_CATEGORY:
            return True
    return False


TYPE_KEY = b'"t":"'


def could_be_helicopter(text):
    """Read the type from the header so most airplanes skip the JSON parse."""
    head = text[:400]
    i = head.find(TYPE_KEY)
    if i < 0:
        return True
    j = head.find(b'"', i + len(TYPE_KEY))
    t = head[i + len(TYPE_KEY):j].decode()
    return not t or t in cfg.HELICOPTER_TYPES


def in_scope(lat, lon, alt):
    b = cfg.BBOX
    return (b["south"] <= lat <= b["north"] and b["west"] <= lon <= b["east"]
            and alt <= cfg.MAX_ALT_FT)


def nyc_points(trace, start, end):
    base = trace["timestamp"]
    out = []
    for p in trace["trace"]:
        t = base + p[0]
        if not start <= t < end or p[6] & STALE:
            continue
        alt = 0 if p[3] == "ground" else p[3]
        if alt is None or not in_scope(p[1], p[2], alt):
            continue
        out.append([round(t, 1), round(p[1], 5), round(p[2], 5), alt])
    return out


def tally_coverage(trace, windows, coverage):
    base = trace["timestamp"]
    for p in trace["trace"]:
        t = base + p[0]
        if not in_scope(p[1], p[2], 0):
            continue
        for day, (start, end) in windows.items():
            if start <= t < end:
                coverage[day][int((t - start) // 3600)] += 1


def scan(archive_day, windows, found, coverage):
    """Add helicopter points from one UTC archive to every local day it covers."""
    stem = "v" + archive_day.strftime("%Y.%m.%d")
    paths = sorted(cfg.ARCHIVE.glob(stem + ".tar.*"))
    if not paths:
        raise FileNotFoundError("no archive parts for " + stem)
    seen = kept = 0
    stream = io.BufferedReader(Parts(paths), buffer_size=1 << 20)
    with tarfile.open(fileobj=stream, mode="r|") as tar:
        for member in tar:
            if not member.isfile() or "/trace_full_" not in member.name:
                continue
            seen += 1
            raw = tar.extractfile(member).read()
            text = gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw
            if seen % cfg.COVERAGE_SAMPLE == 0:
                tally_coverage(json.loads(text), windows, coverage)
            if not could_be_helicopter(text):
                continue
            trace = json.loads(text)
            if not is_helicopter(trace):
                continue
            for day, (start, end) in windows.items():
                points = nyc_points(trace, start, end)
                if not points:
                    continue
                kept += 1
                rec = found[day].setdefault(trace["icao"], {
                    "hex": trace["icao"],
                    "reg": trace.get("r"),
                    "type": trace.get("t"),
                    "desc": trace.get("desc"),
                    "owner": trace.get("ownOp"),
                    "flags": trace.get("dbFlags") or 0,
                    "points": [],
                })
                rec["points"].extend(points)
    print("      %s: %d traces read, %d helicopter tracks kept"
          % (stem, seen, kept))


def main():
    cfg.STAGING.mkdir(parents=True, exist_ok=True)
    windows = {d: local_window(d) for d in cfg.DAYS}
    found = {d: {} for d in cfg.DAYS}
    coverage = {d: [0] * 25 for d in cfg.DAYS}
    archives = sorted({date.fromisoformat(d) + timedelta(days=k)
                       for d in cfg.DAYS for k in (0, 1)})
    for archive_day in archives:
        relevant = {d: w for d, w in windows.items()
                    if archive_day in (date.fromisoformat(d),
                                       date.fromisoformat(d) + timedelta(days=1))}
        scan(archive_day, relevant, found, coverage)
    for day, aircraft in found.items():
        tracks = sorted(aircraft.values(), key=lambda a: a["points"][0][0])
        for a in tracks:
            a["points"].sort()
        path = cfg.STAGING / ("tracks_%s.json" % day)
        path.write_text(json.dumps(tracks, separators=(",", ":")))
        print("      %s: %d helicopters, %d points"
              % (day, len(tracks), sum(len(a["points"]) for a in tracks)))
        write_coverage(day, coverage[day])


def write_coverage(day, hours):
    """Hours run 0 to 23 local. A daylight-saving day can have 23 or 25."""
    start, end = local_window(day)
    hours = hours[:round((end - start) / 3600)]
    gaps = [h for h, n in enumerate(hours) if n == 0]
    path = cfg.STAGING / ("coverage_%s.json" % day)
    path.write_text(json.dumps({"sample": cfg.COVERAGE_SAMPLE,
                                "positions_by_hour": hours, "gaps": gaps}))
    if gaps:
        print("      WARNING %s: no aircraft received in local hours %s. "
              "The archive has a gap; choose another day."
              % (day, ", ".join("%02d" % h for h in gaps)))


if __name__ == "__main__":
    main()
