"""Stage 1: download the adsb.lol daily archives each sample day needs.

An archive is one UTC day of every aircraft adsb.lol received worldwide, split
into 2 GB parts. A New York day spans two UTC days, so each sample day needs
two archives. Parts already on disk at their published size are skipped.
"""

import importlib
import json
import os
import sys
import urllib.request
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
cfg = importlib.import_module("00_config")


def archive_days(days):
    """UTC archive dates needed to cover the given local days."""
    need = set()
    for d in days:
        day = date.fromisoformat(d)
        need.update([day, day + timedelta(days=1)])
    return sorted(need)


def release_assets(day):
    repo = cfg.ARCHIVE_REPO.format(year=day.year)
    tag = cfg.ARCHIVE_TAG.format(dotted=day.strftime("%Y.%m.%d"))
    req = urllib.request.Request(cfg.ARCHIVE_API.format(repo=repo, tag=tag),
                                 headers={"User-Agent": cfg.USER_AGENT})
    with urllib.request.urlopen(req, timeout=cfg.REQUEST_TIMEOUT) as r:
        release = json.load(r)
    return [(a["name"], a["size"], a["browser_download_url"])
            for a in release["assets"]]


def local_name(day, asset_name):
    """v2026.08.02-planes-readsb-prod-0.tar.aa becomes v2026.08.02.tar.aa."""
    return "v%s.tar.%s" % (day.strftime("%Y.%m.%d"), asset_name.rsplit(".", 1)[1])


def download(url, path, size):
    tmp = path.with_suffix(path.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": cfg.USER_AGENT})
    with urllib.request.urlopen(req, timeout=cfg.REQUEST_TIMEOUT) as r, \
            open(tmp, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    if tmp.stat().st_size != size:
        raise RuntimeError("%s arrived at %d bytes, expected %d"
                           % (path.name, tmp.stat().st_size, size))
    tmp.rename(path)


def main(force=False):
    cfg.ARCHIVE.mkdir(parents=True, exist_ok=True)
    for day in archive_days(cfg.DAYS):
        for name, size, url in release_assets(day):
            path = cfg.ARCHIVE / local_name(day, name)
            if not force and path.exists() and path.stat().st_size == size:
                print("      have %s" % path.name)
                continue
            print("      downloading %s, %.1f GB" % (path.name, size / 1e9))
            download(url, path, size)


if __name__ == "__main__":
    main()
