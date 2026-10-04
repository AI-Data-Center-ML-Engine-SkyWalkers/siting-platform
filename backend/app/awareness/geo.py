"""Place items on the map: state codes, county FIPS and centroids from a US county gazetteer."""
from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

STATES = {
    "01": ("AL", "Alabama"), "02": ("AK", "Alaska"), "04": ("AZ", "Arizona"), "05": ("AR", "Arkansas"),
    "06": ("CA", "California"), "08": ("CO", "Colorado"), "09": ("CT", "Connecticut"), "10": ("DE", "Delaware"),
    "11": ("DC", "District of Columbia"), "12": ("FL", "Florida"), "13": ("GA", "Georgia"), "15": ("HI", "Hawaii"),
    "16": ("ID", "Idaho"), "17": ("IL", "Illinois"), "18": ("IN", "Indiana"), "19": ("IA", "Iowa"),
    "20": ("KS", "Kansas"), "21": ("KY", "Kentucky"), "22": ("LA", "Louisiana"), "23": ("ME", "Maine"),
    "24": ("MD", "Maryland"), "25": ("MA", "Massachusetts"), "26": ("MI", "Michigan"), "27": ("MN", "Minnesota"),
    "28": ("MS", "Mississippi"), "29": ("MO", "Missouri"), "30": ("MT", "Montana"), "31": ("NE", "Nebraska"),
    "32": ("NV", "Nevada"), "33": ("NH", "New Hampshire"), "34": ("NJ", "New Jersey"), "35": ("NM", "New Mexico"),
    "36": ("NY", "New York"), "37": ("NC", "North Carolina"), "38": ("ND", "North Dakota"), "39": ("OH", "Ohio"),
    "40": ("OK", "Oklahoma"), "41": ("OR", "Oregon"), "42": ("PA", "Pennsylvania"), "44": ("RI", "Rhode Island"),
    "45": ("SC", "South Carolina"), "46": ("SD", "South Dakota"), "47": ("TN", "Tennessee"), "48": ("TX", "Texas"),
    "49": ("UT", "Utah"), "50": ("VT", "Vermont"), "51": ("VA", "Virginia"), "53": ("WA", "Washington"),
    "54": ("WV", "West Virginia"), "55": ("WI", "Wisconsin"), "56": ("WY", "Wyoming"), "72": ("PR", "Puerto Rico"),
}
ABBR_TO_FIPS = {abbr: fips for fips, (abbr, _) in STATES.items()}
NAME_TO_ABBR = {name.lower(): abbr for _, (abbr, name) in STATES.items()}
ABBR_TO_NAME = {abbr: name for _, (abbr, name) in STATES.items()}

# "Loudoun County", "St. Tammany Parish", "Fairbanks North Star Borough"
COUNTY_RE = re.compile(
    r"\b((?:St\.?|Saint|De|Du|La|Le|Mc|O')?\s?[A-Z][a-zA-Z.'-]+(?:\s[A-Z][a-zA-Z.'-]+){0,3})\s(County|Parish|Borough|Census Area)\b"
)
STATE_NAME_RE = re.compile(r"\b(" + "|".join(sorted((re.escape(n.title()) for n in NAME_TO_ABBR), key=len, reverse=True)) + r")\b")
# Postal codes only in safe patterns like "Ashburn, VA" to avoid matching words like "IN" or "OR".
STATE_ABBR_RE = re.compile(r",\s(" + "|".join(ABBR_TO_FIPS) + r")\b")


@dataclass(frozen=True)
class County:
    fips: str
    name: str
    state: str  # 2-letter
    lat: float
    lon: float

    @property
    def label(self) -> str:
        return f"{self.name}, {self.state}"


@lru_cache
def counties() -> dict[str, County]:
    path = Path(__file__).resolve().parent.parent / "data" / "counties.csv"
    out: dict[str, County] = {}
    with path.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            state = STATES.get(row["state_fips"], (None,))[0]
            if not state:
                continue
            out[row["fips"]] = County(row["fips"], row["name"], state, float(row["lat"]), float(row["lon"]))
    return out


@lru_cache
def county_name_index() -> dict[str, list[County]]:
    index: dict[str, list[County]] = {}
    for c in counties().values():
        index.setdefault(_key(c.name), []).append(c)
    return index


def _key(name: str) -> str:
    name = name.lower().replace("saint ", "st. ").replace("st ", "st. ")
    return re.sub(r"\s+", " ", name).strip()


def state_from_text(text: str) -> str | None:
    found = [NAME_TO_ABBR[m.group(1).lower()] for m in STATE_NAME_RE.finditer(text)]
    found += [m.group(1) for m in STATE_ABBR_RE.finditer(text)]
    if not found:
        return None
    # Most mentioned state wins; ties go to the first mention
    return max(dict.fromkeys(found), key=found.count)


def find_county(name: str | None, state: str | None = None) -> County | None:
    if not name:
        return None
    clean = re.sub(r"\s(county|parish|borough|census area)$", "", name.strip(), flags=re.I)
    matches = county_name_index().get(_key(clean), [])
    if state:
        matches = [c for c in matches if c.state == state.upper()]
    return matches[0] if len(matches) == 1 else None


def geotag(text: str, state_hint: str | None = None) -> tuple[str | None, str | None, str | None]:
    """Return (state, county_fips, method) from free text. County names need a state to disambiguate."""
    state = state_hint or state_from_text(text)
    for match in COUNTY_RE.finditer(text):
        words = match.group(1).split()
        # "The Loudoun County" -> try "The Loudoun", then "Loudoun"
        for start in range(len(words)):
            county = find_county(" ".join(words[start:]), state)
            if county:
                return county.state, county.fips, "gazetteer"
    return state, None, ("gazetteer" if state else None)


def state_name(abbr: str | None) -> str | None:
    return ABBR_TO_NAME.get((abbr or "").upper())


def county(fips: str | None) -> County | None:
    return counties().get(fips or "")
