"""Stage 4: correct altitudes, split tracks into flights, and give each flight
a category.

Transponders report pressure altitude, which assumes standard air pressure. On
a high-pressure day a helicopter parked on a pier reads 200 ft below the
water. Each point is corrected with LaGuardia's hourly altimeter setting.

A flight ends at a long data gap, at a shorter gap that starts and ends low,
or at a ground stay long enough to be a landing.
Short ground blips are ignored, because some transponders report "on ground"
while hovering low.

Categories, in the order they are tested:

    military   readsb marks the aircraft as military
    police     the registered owner is a police or state agency
    medical    the registered owner is an air ambulance operator or hospital
    tour       the flight touches a tour base or loops back to where it began,
               passes the Statue of Liberty, never leaves the map, lasts under
               45 minutes, and uses a light single-engine type
    charter    everything else: charter, commuter, airport and private flights

Owner names settle the first three. Tours are recognised by what they do,
because tour operators register aircraft under leasing companies and many
withhold their names (LADD).

Aircraft whose owners asked the FAA to limit display (LADD) and aircraft on a
privacy address (PIA) lose their registration, owner and address here. They
are still counted, with their type and category.

Output, one file per day, in build/staging/:

    flights_2026-08-02.json   [{id, aircraft, category, points}]
"""

import importlib
import json
import math
import bisect
import csv
import io
import statistics
import os
import sys
import urllib.request
import zipfile
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
cfg = importlib.import_module("00_config")


def altimeter(day):
    """[(unix seconds, inHg)] for the local day, with an hour either side."""
    path = cfg.WEATHER / ("%s_%s.csv" % (cfg.ALTIMETER_STATION, day))
    if not path.exists():
        d = date.fromisoformat(day)
        a, b = d - timedelta(days=1), d + timedelta(days=2)
        url = cfg.ALTIMETER_URL.format(station=cfg.ALTIMETER_STATION,
                                       y1=a.year, m1=a.month, d1=a.day,
                                       y2=b.year, m2=b.month, d2=b.day)
        req = urllib.request.Request(url, headers={"User-Agent": cfg.USER_AGENT})
        with urllib.request.urlopen(req, timeout=cfg.REQUEST_TIMEOUT) as r:
            text = r.read().decode()
        if not text.startswith("station,valid,alti"):
            raise RuntimeError("altimeter download is not the expected CSV")
        cfg.WEATHER.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    out = []
    for row in csv.DictReader(io.StringIO(path.read_text())):
        if row["alti"] not in ("", "M"):
            t = datetime.strptime(row["valid"], "%Y-%m-%d %H:%M")
            out.append((t.replace(tzinfo=timezone.utc).timestamp(),
                        float(row["alti"])))
    return sorted(out)


def correct_altitude(points, setting):
    """Pressure altitude to altitude above sea level, using the nearest
    earlier altimeter reading. Ground points stay at 0."""
    times = [t for t, _ in setting]
    for p in points:
        if p[3] == 0:
            continue
        k = max(bisect.bisect_right(times, p[0]) - 1, 0)
        p[3] = round(p[3] + (setting[k][1] - cfg.STANDARD_INHG) * cfg.FT_PER_INHG)


def registry_seats(regs):
    """{N-number: certified seats} for the given registrations."""
    path = cfg.FAA / "ReleasableAircraft.zip"
    if not path.exists():
        cfg.FAA.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(cfg.FAA_REGISTRY_URL,
                                     headers={"User-Agent": cfg.FAA_USER_AGENT})
        with urllib.request.urlopen(req, timeout=300) as r:
            path.write_bytes(r.read())
    wanted = {r[1:] for r in regs if r and r.startswith("N")}
    with zipfile.ZipFile(path) as z:
        def table(name):
            return csv.DictReader(io.TextIOWrapper(z.open(name), "utf-8-sig"))
        models = {r["CODE"].strip(): int(r["NO-SEATS"])
                  for r in table("ACFTREF.txt") if r["NO-SEATS"].strip().isdigit()}
        return {"N" + r["N-NUMBER"].strip(): models.get(r["MFR MDL CODE"].strip())
                for r in table("MASTER.txt") if r["N-NUMBER"].strip() in wanted}


def seat_counts(all_tracks):
    """Seats per ICAO address. Aircraft without a US registration take the
    median of their type among the aircraft that have one."""
    seats = registry_seats({a["reg"] for t in all_tracks for a in t})
    by_type = {}
    for t in all_tracks:
        for a in t:
            if seats.get(a["reg"]):
                by_type.setdefault(a["type"], []).append(seats[a["reg"]])
    out = {}
    for t in all_tracks:
        for a in t:
            n = seats.get(a["reg"])
            if n is None and by_type.get(a["type"]):
                n = round(statistics.median(by_type[a["type"]]))
            out[a["hex"]] = n
    return out


def km(lat1, lon1, lat2, lon2):
    """Flat-earth distance, accurate to well under 1% across the city."""
    return math.hypot(lat1 - lat2, (lon1 - lon2) * cfg.LON_SCALE) * 111.2


def is_landing_gap(a, b):
    """Receivers often lose a helicopter once it is on the ground, so a
    silence that starts and ends low is a landing even when it is short."""
    gap = b[0] - a[0]
    low = a[3] <= cfg.LOW_FT and b[3] <= cfg.LOW_FT
    return gap > cfg.MAX_GAP_S or (low and gap > cfg.LOW_GAP_S)


def flights(points):
    """Split one aircraft's day into flights."""
    cuts = set()
    i = 0
    while i < len(points):
        if i and is_landing_gap(points[i - 1], points[i]):
            cuts.add(i)
        if points[i][3] == 0:
            j = i
            while (j + 1 < len(points) and points[j + 1][3] == 0
                   and points[j + 1][0] - points[j][0] <= cfg.MAX_GAP_S):
                j += 1
            if points[j][0] - points[i][0] >= cfg.MIN_GROUND_S:
                cuts.update(range(i, j + 1))
            i = j + 1
        else:
            i += 1

    flight = []
    for k, p in enumerate(points):
        if k in cuts:
            if long_enough(flight):
                yield flight
            flight = [] if p[3] == 0 else [p]
        else:
            flight.append(p)
    if long_enough(flight):
        yield flight


def long_enough(flight):
    return flight and flight[-1][0] - flight[0][0] >= cfg.MIN_FLIGHT_S


def near_tour_base(p):
    return p[3] <= cfg.LOW_FT and any(
        km(p[1], p[2], *base) < cfg.BASE_RADIUS_KM
        for base in cfg.TOUR_BASES.values())


def at_edge(p):
    """Within EDGE_KM of the box: the flight came from or left for elsewhere."""
    b = cfg.BBOX
    return min((p[1] - b["south"]) * 111.2, (b["north"] - p[1]) * 111.2,
               (p[2] - b["west"]) * 111.2 * cfg.LON_SCALE,
               (b["east"] - p[2]) * 111.2 * cfg.LON_SCALE) < cfg.EDGE_KM


def category(aircraft, flight):
    owner = (aircraft["owner"] or "").upper()
    if aircraft["flags"] & cfg.FLAG_MILITARY:
        return "military"
    if any(k in owner for k in cfg.POLICE_OWNERS):
        return "police"
    if any(k in owner for k in cfg.MEDICAL_OWNERS):
        return "medical"

    first, last = flight[0], flight[-1]
    loop = (first[3] <= cfg.LOW_FT and last[3] <= cfg.LOW_FT
            and km(first[1], first[2], last[1], last[2]) < cfg.BASE_RADIUS_KM)
    from_base = near_tour_base(first) or near_tour_base(last)
    statue = min(km(p[1], p[2], *cfg.STATUE) for p in flight)
    local = not (at_edge(first) or at_edge(last))
    short = last[0] - first[0] <= cfg.MAX_TOUR_S
    tour_type = aircraft["type"] in cfg.TOUR_TYPES
    if ((loop or from_base) and local and short and tour_type
            and statue < cfg.STATUE_RADIUS_KM):
        return "tour"
    return "charter"


def public_record(a, withheld_count, seats):
    """What the site may show about an aircraft.

    Withheld aircraft are numbered within the day. A hash of the address would
    be reversible, since there are only 16 million addresses to try.
    """
    hidden = a["flags"] & (cfg.FLAG_LADD | cfg.FLAG_PIA) or a["hex"].startswith("~")
    if hidden:
        rec = {"id": "w%d" % withheld_count, "reg": None, "owner": None,
               "type": a["type"], "withheld": True}
    else:
        rec = {"id": a["hex"], "reg": a["reg"], "owner": a["owner"],
               "type": a["type"], "withheld": False}
    rec["seats"] = seats
    rec["riders_max"] = max(seats - cfg.PILOTS, 0) if seats else None
    return rec


def main():
    all_tracks = {day: json.loads((cfg.STAGING / ("tracks_%s.json" % day)).read_text())
                  for day in cfg.DAYS}
    seats = seat_counts(all_tracks.values())
    for day in cfg.DAYS:
        tracks = all_tracks[day]
        setting = altimeter(day)
        for a in tracks:
            correct_altitude(a["points"], setting)
        out = []
        withheld = 0
        for a in tracks:
            rec = public_record(a, withheld + 1, seats[a["hex"]])
            withheld += rec["withheld"]
            for n, flight in enumerate(flights(a["points"])):
                out.append({"id": "%s-%d" % (rec["id"], n),
                            "aircraft": rec,
                            "category": category(a, flight),
                            "points": flight})
        out.sort(key=lambda f: f["points"][0][0])
        (cfg.STAGING / ("flights_%s.json" % day)).write_text(
            json.dumps(out, separators=(",", ":")))

        counts = {}
        for f in out:
            c = counts.setdefault(f["category"], [0, 0.0])
            c[0] += 1
            c[1] += (f["points"][-1][0] - f["points"][0][0]) / 3600
        print("      %s: %s" % (day, ", ".join(
            "%s %d (%.0f h)" % (k, v[0], v[1])
            for k, v in sorted(counts.items(), key=lambda kv: -kv[1][1]))))


if __name__ == "__main__":
    main()
