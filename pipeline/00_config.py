"""Every tunable value for the helicopters site.

Nothing downstream hard-codes a URL, a boundary, a threshold or a date. Change a
value here and rebuild.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data-raw"
ARCHIVE = RAW / "adsblol"
BUILD = ROOT / "build"
STAGING = BUILD / "staging"
SITE = ROOT / "docs"
SITE_DATA = SITE / "data"

USER_AGENT = (
    "PublicWorksChopperNoise/0.1 (+https://choppernoise.publicworks.nyc) "
    "public-data reconstruction"
)
REQUEST_TIMEOUT = 60

# ---------------------------------------------------------------------------
# Sample days
# ---------------------------------------------------------------------------
# Days are New York local days. Each adsb.lol archive covers one UTC day, so a
# local day needs its own archive and the next one.

DAYS = ["2026-08-02", "2026-08-15", "2026-09-16"]
TIMEZONE = "America/New_York"

# Coverage is checked on one trace in this many. Every aircraft counts, so a
# sample is plenty to see whether an hour has any data at all.
COVERAGE_SAMPLE = 4

ARCHIVE_REPO = "adsblol/globe_history_{year}"
ARCHIVE_TAG = "v{dotted}-planes-readsb-prod-0"
ARCHIVE_API = "https://api.github.com/repos/{repo}/releases/tags/{tag}"

# ---------------------------------------------------------------------------
# Geography
# ---------------------------------------------------------------------------
# A box around the five boroughs, with a margin for the New Jersey waterfront.
# Sound crosses the Hudson, so flights just outside the city still count.

BBOX = {"south": 40.47, "north": 40.93, "west": -74.28, "east": -73.68}

# Residents come from the 2020 Census, block by block. The five boroughs are
# five counties: Bronx, Kings, New York, Queens, Richmond.

CENSUS = RAW / "census"
BLOCKS_URL = ("https://www2.census.gov/geo/tiger/TIGER2020/TABBLOCK20/"
              "tl_2020_{state}_tabblock20.zip")

# Residents are counted in two regions. Noise crosses the Hudson, so New
# Jersey blocks inside the box count too, reported on their own line.
REGIONS = {
    "nyc": {"label": "New York City", "state": "36",
            "counties": {"005", "047", "061", "081", "085"}},
    "nj": {"label": "New Jersey", "state": "34", "counties": None},
}

# Helicopters above this altitude are out of scope. Tour and commuter routes
# sit well below it.
MAX_ALT_FT = 3000

# ---------------------------------------------------------------------------
# Aircraft
# ---------------------------------------------------------------------------
# ADS-B emitter category A7 means rotorcraft. Some transponders never send a
# category, so known helicopter type designators are a second test.

ROTORCRAFT_CATEGORY = "A7"
HELICOPTER_TYPES = {
    "A109", "A119", "A139", "A169", "AS32", "AS50", "AS55", "AS65", "B06",
    "B06T", "B105", "B212", "B222", "B230", "B407", "B412", "B427", "B429",
    "B430", "B505", "BK17", "EC20", "EC25", "EC30", "EC35", "EC45", "EC55",
    "EC75", "EH10", "H160", "H47", "H53", "H53S", "H60", "MD52", "MD60",
    "R22", "R44", "R66", "S61", "S64", "S76", "S92", "UH1", "UH1Y", "V22",
}

# What the site calls each type. Designators missing here show as the code.
TYPE_NAMES = {
    "A109": "Leonardo AW109", "A119": "Leonardo AW119", "A139": "Leonardo AW139",
    "A169": "Leonardo AW169", "AS32": "Airbus Super Puma", "AS50": "Airbus H125",
    "AS55": "Airbus AS355", "AS65": "Airbus Dauphin", "B06": "Bell 206",
    "B06T": "Bell 206L TwinRanger", "B105": "MBB Bo 105", "B212": "Bell 212",
    "B222": "Bell 222", "B230": "Bell 230", "B407": "Bell 407", "B412": "Bell 412",
    "B427": "Bell 427", "B429": "Bell 429", "B430": "Bell 430", "B505": "Bell 505",
    "BK17": "MBB/Kawasaki BK 117", "EC20": "Airbus EC120", "EC25": "Airbus H225",
    "EC30": "Airbus H130", "EC35": "Airbus H135", "EC45": "Airbus H145",
    "EC55": "Airbus EC155", "EC75": "Airbus H175", "EH10": "Leonardo AW101",
    "H160": "Airbus H160", "H47": "Boeing CH-47 Chinook", "H53": "Sikorsky CH-53",
    "H53S": "Sikorsky CH-53E", "H60": "Sikorsky H-60 Black Hawk",
    "MD52": "MD 520N", "MD60": "MD 600N", "R22": "Robinson R22",
    "R44": "Robinson R44", "R66": "Robinson R66", "S61": "Sikorsky S-61",
    "S64": "Sikorsky S-64 Skycrane", "S76": "Sikorsky S-76", "S92": "Sikorsky S-92",
    "UH1": "Bell UH-1", "UH1Y": "Bell UH-1Y Venom", "V22": "Bell Boeing V-22 Osprey",
}

# ---------------------------------------------------------------------------
# Flights and categories
# ---------------------------------------------------------------------------

# Hourly altimeter settings from the Iowa Environmental Mesonet ASOS archive.
WEATHER = RAW / "weather"
ALTIMETER_STATION = "LGA"
ALTIMETER_URL = (
    "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station={station}"
    "&data=alti&year1={y1}&month1={m1}&day1={d1}&year2={y2}&month2={m2}"
    "&day2={d2}&tz=Etc/UTC&format=onlycomma&latlon=no&missing=M&report_type=3"
)
STANDARD_INHG = 29.92
FT_PER_INHG = 927  # 27.4 ft per hPa near sea level

LON_SCALE = 0.758  # cos(40.7 degrees): a degree of longitude in degrees of latitude

MAX_GAP_S = 600  # a longer silence ends a flight
LOW_GAP_S = 120  # a silence this long that starts and ends low is a landing
MIN_GROUND_S = 90  # a shorter ground stay is a blip, not a landing
MIN_FLIGHT_S = 120  # shorter fragments are dropped
LOW_FT = 800  # at or below this, a point counts as taking off or landing

# Tour helicopters fly from these three places. Kearny and Linden are in New
# Jersey; their tours cross into the city.
TOUR_BASES = {
    "Downtown Manhattan Heliport": (40.7012, -74.0090),
    "Kearny": (40.7300, -74.1170),
    "Linden": (40.6174, -74.2446),
}
BASE_RADIUS_KM = 1.5
STATUE = (40.6892, -74.0445)
STATUE_RADIUS_KM = 1.0

# Tours start and end in the city. A flight first or last seen this close to
# the edge of the box came from or left for somewhere else.
EDGE_KM = 3.0

# Tours are short, and NYC tour operators fly light single-engine types. Charter
# twins (S-76, S-92, AW139) pass the Statue on their way between Kearny and the
# Manhattan heliports, so type keeps them out. None covers transponders that
# send no type, including FlyNYON's.
MAX_TOUR_S = 45 * 60
TOUR_TYPES = {"B06", "B407", "B505", "AS50", "EC30", "R44", "R66", "A119", None}

# Matched against the registered owner, in capitals.
POLICE_OWNERS = ("POLICE", "STATE OF NEW JERSEY",
                 "WESTCHESTER COUNTY DEPARTMENT OF PUBLIC")
MEDICAL_OWNERS = ("AIR METHODS", "MED-TRANS", "HOSPITAL")

# ---------------------------------------------------------------------------
# Noise
# ---------------------------------------------------------------------------
# Certified flyover levels come from the UK CAA noise database. Light types are
# certified in SEL (ICAO Annex 16 Chapter 11), heavier ones in EPNdB (Chapter
# 8), both at 150 m. Each becomes a peak level, LAmax, at 150 m.

NOISE = RAW / "noise"
CAADB_FILE = "caadb_helicopters.xlsx"
CAADB_URL = ("https://www.caa.co.uk/Documents/Download/3755/"
             "a12c945b-a43b-4cfe-b9d2-816a329a323a/4002")

REF_DISTANCE_M = 150.0

# Median EPNdB minus SEL across the 12 types the database certifies both ways.
EPNL_TO_SEL_DB = 2.7

# A steady straight pass with spherical spreading gives
# SEL - LAmax = 10 log10(pi * d / V). Chapter 11 flies at about 0.9 VH,
# roughly 55 m/s for the light types, which gives 9.3 dB at 150 m.
FLYOVER_SPEED_MS = 55.0

# Air absorbs sound on top of spreading. Rotor noise is mostly low frequency,
# so this uses the ISO 9613-1 value near 500 Hz on a mild humid day.
ABSORPTION_DB_PER_KM = 2.0

# ICAO type designator to the CAA type designations it covers. Military and
# unknown types borrow a civil type of similar size; NOISE_PROXY records which.
NOISE_TYPES = {
    "A109": r"^A ?W?109", "A119": r"^A ?W?119", "A139": r"^A[BW]139",
    "A169": r"^AW169", "AS50": r"^AS 350", "AS55": r"^AS 355",
    "B06": r"^206", "B407": r"^407", "B412": r"^412", "B427": r"^427",
    "B429": r"^429", "B505": r"^505", "EC30": r"^EC130", "EC35": r"^EC135",
    "EC45": r"^MBB-BK117 ?C-2", "EC55": r"^EC155", "H160": r"^H160",
    "R44": r"^R44", "R66": r"^R66", "S76": r"^S-76", "S92": r"^S-92",
}
NOISE_PROXY = {"H60": "S92", "V22": "S92", None: "B407"}

# Bands of peak level, dBA. The site draws each as a ring. Its headline counts
# from 60: a busy street already sits near 65 to 70, so 60 keeps it conservative.
BANDS = [50, 60, 70, 80]
STEP_S = 10  # exposure is sampled this often along each flight
EVENT_STEPS = [1, 10, 25, 50, 100]  # summary thresholds for flights heard per day

# Seats come from the FAA aircraft registry: each registration's model and that
# model's certified seat count, crew included. Riders are reported as at most
# seats minus one pilot. Many charter cabins hold fewer than certified, so the
# figure leans in the helicopters' favour.
FAA = RAW / "faa"
FAA_REGISTRY_URL = "https://registry.faa.gov/database/ReleasableAircraft.zip"
# The registry's host refuses requests that do not look like a browser.
FAA_USER_AGENT = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36")
PILOTS = 1

# The site's two headline groups. Each category stays visible on its own too.
GROUPS = {
    "non-essential": ("tour", "charter"),
    "public service": ("police", "medical", "military"),
}

# readsb database flags, a bit field
FLAG_MILITARY = 1
FLAG_PIA = 4  # privacy ICAO address, a rotating anonymous identifier
FLAG_LADD = 8  # owner asked the FAA to limit public display
