"""Search terms and the keyword filter every item must pass before it is stored."""
import re

DATA_CENTER_PATTERN = re.compile(
    r"\b(data[\s-]?cent(?:er|re)s?|datacent(?:er|re)s?|hyperscale(?:r|rs)?|server\s+farms?|ai\s+campus(?:es)?)\b",
    re.IGNORECASE,
)

# Context words that make a data center story relevant to siting decisions.
CONTEXT_TERMS = [
    "moratorium", "zoning", "rezoning", "protest", "opposition", "residents", "hearing",
    "tax break", "tax exemption", "incentive", "abatement", "ordinance", "lawsuit",
    "water", "noise", "electric bills", "power bills", "rates", "transmission", "permit",
    "jobs", "canceled", "cancelled", "withdrawn", "approved", "denied", "petition",
]

# Query strings per source. Kept here so the whole team searches the same way.
GDELT_QUERY = (
    '("data center" OR "data centers" OR datacenter) '
    '(moratorium OR rezoning OR zoning OR protest OR opposition OR "tax break" OR incentive '
    'OR abatement OR ordinance OR hearing OR lawsuit) sourcecountry:US'
)

GOOGLE_NEWS_QUERIES = [
    '"data center" moratorium',
    '"data center" (rezoning OR zoning) vote',
    '"data center" (protest OR opposition OR residents)',
    '"data center" ("tax break" OR "tax exemption" OR incentive OR abatement)',
    '"data center" (water OR noise OR "electric bills" OR "power bills")',
    '"data center" (canceled OR withdrawn OR scrapped)',
]

LEGISLATION_QUERY = '"data center" OR datacenter OR "data centers"'
SOCIAL_QUERY = '"data center"'
MASTODON_TAGS = ["datacenter", "datacenters"]

SUBREDDIT_QUERY = '"data center" OR datacenter'

# Federal Register full-text search
FEDERAL_REGISTER_TERM = '"data center" | "data centers"'


def mentions_data_center(*texts: str | None) -> bool:
    return any(t and DATA_CENTER_PATTERN.search(t) for t in texts)
