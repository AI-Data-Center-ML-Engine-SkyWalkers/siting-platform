"""Search terms and the keyword filter every item must pass before it is stored."""
import re

# Real facility language — not a lone #DataCenters hashtag on unrelated AI posts.
DATA_CENTER_PATTERN = re.compile(
    r"\b("
    r"ai[\s-]?data[\s-]?cent(?:er|re)s?"
    r"|data[\s-]?cent(?:er|re)s?"
    r"|datacent(?:er|re)s?"
    r"|hyperscale(?:r|rs)?"
    r"|server\s+farms?"
    r"|ai\s+campus(?:es)?"
    r")\b",
    re.IGNORECASE,
)

# Mastodon/HTML often turns #DataCenters into "# DataCenters".
HASHTAG_RE = re.compile(r"#\s*[\w-]+", re.UNICODE)

# Context words that make a data center story relevant to siting decisions.
CONTEXT_TERMS = [
    "moratorium", "zoning", "rezoning", "protest", "opposition", "residents", "hearing",
    "tax break", "tax exemption", "incentive", "abatement", "ordinance", "lawsuit",
    "water", "noise", "electric bills", "power bills", "rates", "transmission", "permit",
    "jobs", "canceled", "cancelled", "withdrawn", "approved", "denied", "petition",
]

# Query strings per source. Kept here so the whole team searches the same way.
GDELT_QUERY = (
    '(("data center" OR "data centers" OR datacenter OR "AI data center" OR "AI datacenter") '
    '(moratorium OR rezoning OR zoning OR protest OR opposition OR "tax break" OR incentive '
    'OR abatement OR ordinance OR hearing OR lawsuit OR campus OR facility OR construction)) '
    'sourcecountry:US'
)

GOOGLE_NEWS_QUERIES = [
    '"data center" moratorium',
    '"data center" (rezoning OR zoning) vote',
    '"data center" (protest OR opposition OR residents)',
    '"data center" ("tax break" OR "tax exemption" OR incentive OR abatement)',
    '"data center" (water OR noise OR "electric bills" OR "power bills")',
    '"data center" (canceled OR withdrawn OR scrapped)',
    '("AI data center" OR "AI datacenter" OR "AI data centers" OR "artificial intelligence data center")',
]

LEGISLATION_QUERY = '"data center" OR datacenter OR "data centers" OR "AI data center"'
SOCIAL_QUERY = '"data center" OR "AI data center"'
MASTODON_TAGS = ["datacenter", "datacenters", "aidatacenter", "aidatacenters"]

SUBREDDIT_QUERY = '"data center" OR datacenter OR "AI data center"'

# Federal Register full-text search
FEDERAL_REGISTER_TERM = '"data center" | "data centers" | "AI data center"'


def _blob(*texts: str | None) -> str:
    return " ".join(t for t in texts if t)


def mentions_data_center(*texts: str | None) -> bool:
    return bool(DATA_CENTER_PATTERN.search(_blob(*texts)))


def is_data_center_news(*texts: str | None) -> bool:
    """Keep data-center or AI data-center news. Drop hashtag-only tech chatter."""
    body = HASHTAG_RE.sub(" ", _blob(*texts))
    return bool(DATA_CENTER_PATTERN.search(body))
