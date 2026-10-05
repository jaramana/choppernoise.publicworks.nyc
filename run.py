#!/usr/bin/env python3
"""Run the pipeline stages in order.

    python3 run.py                 everything, using the cache where it exists
    python3 run.py --stage 2       one stage on its own
    python3 run.py --from 2        stage 2 onward
    python3 run.py --force-fetch   download everything again
    python3 run.py --skip-fetch    use the cache, do not check for new files

Nothing to install. The pipeline uses the standard library only, so any
Python 3.9 or newer will run it.
"""

import argparse
import importlib
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "pipeline"))

STAGES = [
    ("01_fetch", "download the flight archives"),
    ("02_extract", "pull NYC helicopter tracks"),
    ("03_blocks", "place residents by Census block"),
    ("04_classify", "split flights and name their category"),
    ("05_noise", "model loudness and count residents by band"),
    ("06_publish", "write the files the map reads"),
]


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--stage", type=int, help="run one stage, 1 to %d" % len(STAGES))
    ap.add_argument("--from", dest="start", type=int, default=1,
                    help="start at this stage and run to the end")
    ap.add_argument("--force-fetch", action="store_true")
    ap.add_argument("--skip-fetch", action="store_true")
    args = ap.parse_args()

    chosen = ([args.stage] if args.stage
              else list(range(args.start, len(STAGES) + 1)))

    began = time.time()
    for n in chosen:
        name, what = STAGES[n - 1]
        if n == 1 and args.skip_fetch:
            print(f"[{n}/{len(STAGES)}] skipping fetch, using the cache")
            continue
        print(f"\n[{n}/{len(STAGES)}] {name}: {what}")
        module = importlib.import_module(name)
        started = time.time()
        if n == 1:
            module.main(force=args.force_fetch)
        else:
            module.main()
        print(f"      {time.time() - started:.0f}s")

    print(f"\nDone in {time.time() - began:.0f}s.")


if __name__ == "__main__":
    main()
