# Chopper Noise

[Chopper Noise](https://choppernoise.publicworks.nyc) is an independent
[publicworks.nyc](https://publicworks.nyc) map of helicopter noise over New York
City and the Hudson waterfront. It replays recorded helicopter flights and counts
the residents of each Census block who hear them, and how often, at modeled peak
levels.

## Data sources

| Source | Used for |
| --- | --- |
| [adsb.lol flight archive](https://github.com/adsblol/globe_history_2026) | Helicopter positions, types, owner names and privacy flags on 2 August, 15 August and 16 September 2026 |
| [Census Bureau 2020 TIGER/Line blocks](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.2020.html) | Residents and a point inside each block, New York and New Jersey |
| [FAA aircraft registry](https://www.faa.gov/licenses_certificates/aircraft_certification/aircraft_registry/releasable_aircraft_download) | Certified seats for each registered aircraft (files dated 2 October 2026) |
| [Iowa Environmental Mesonet ASOS archive](https://mesonet.agron.iastate.edu/request/download.phtml) | LaGuardia's hourly altimeter setting on the same days |
| [UK CAA helicopter noise database](https://www.caa.co.uk/commercial-industry/aircraft/airworthiness/type-certificate-and-type-approval-data-sheets/part-21/noise-certificates/aircraft-noise-certificate/) | Certified flyover level of each type (edition of 1 September 2026) |

Map tiles come from OpenFreeMap, with OpenStreetMap data.

## Method and limits

- Flights: stages 1 and 2 stream the adsb.lol archives, two UTC days for each
  local day, and keep helicopters inside `BBOX` below 3,000 ft. The type
  designator decides what counts as a helicopter, with ADS-B category A7 as a
  fallback. An hourly coverage check flags archive gaps; 1 August was dropped for
  one.
- Categories: stage 4 corrects altitudes with LaGuardia's altimeter setting,
  splits flights at landings and long gaps, and sets a category. Military comes
  from the readsb flag, police and medical from owner names, tours from flight
  shape, and charter covers the rest. Tours and charters are non-essential;
  police, medical and military are public service.
- Noise: stage 5 gives each type a peak level (LAmax) at 150 m from the CAA's
  median certified level, SEL − 9.3 dB, with EPNL types first converted to SEL
  by subtracting 2.7 dB. The level at slant distance r is
  `L150 − 20 log10(r / 150) − 2 (r − 150) / 1000`, sampled every 10 seconds and
  counted at 50, 60, 70 and 80 dBA. Each block also counts the flights it heard
  at each level.
- Residents: 2020 Census block points, New York City by county and New Jersey
  inside the box. That is 51,164 populated blocks, with 8.80 million residents in
  New York City and 2.83 million in New Jersey. Riders are certified seats minus
  one pilot, an upper bound.
- Privacy: published files carry no registration, owner or transponder address,
  and flights are numbered within each day. Aircraft on the FAA's LADD list or a
  privacy address are counted like the rest.
- Limits: levels are modeled outdoor peaks and have not yet been checked against
  a measured flyover. Buildings and directivity are ignored, height is above sea
  level, and only three days are sampled.

The [Data page](https://choppernoise.publicworks.nyc/data.html) has the sources,
steps, formulas and limits.

## Updates

The pipeline runs by hand and has no schedule. It uses only the Python standard
library, so any Python 3.9 or newer runs it with nothing to install.

```sh
python3 run.py
```

Raw downloads are about 21 GB in `data-raw/`, and working files are in
`build/staging/`; Git ignores both. To rewrite the site files in `docs/data/`
from staging without reading the raw data again:

```sh
python3 run.py --stage 6
```

Sample days, the flight box, categories and model constants live in
`pipeline/00_config.py`. Stage 2 warns when an hour has no aircraft at all;
choose another day when it does. The source periods on the Data page are typed
by hand, so update them when a source is downloaded again.

To preview the site, which is all of `docs/` with no build step:

```sh
python3 -m http.server 8771 --directory docs
```

Open http://localhost:8771. Stylesheet and script links carry a `?v=` tag.
Change it on every page that loads a file whenever that file changes.

## Tools

Data pipeline: Python, standard library only. Website: static HTML, CSS and
JavaScript with MapLibre GL JS 4.7.1, kept in `docs/vendor/`, and OpenFreeMap's
Positron tiles. The site uses no account system or analytics. Claude was used in
development.

## License and reuse

Code is [BSD 3-Clause licensed](LICENSE). Source data keep their publishers'
terms; adsb.lol publishes its archive under the
[Open Database License](https://opendatacommons.org/licenses/odbl/1-0/). When
you reuse a figure, carry the day and the level and say it is modeled. The
metadata download is on the Data page.
