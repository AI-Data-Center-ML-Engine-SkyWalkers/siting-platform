"""Clean scraped text, canonicalize URLs and detect duplicates."""
import hashlib
import html
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

TRACKING_PARAMS = re.compile(r"^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|ref_src$|cmpid$|ocid$|smid$|s$)", re.I)
TAG_RE = re.compile(r"<[^>]+>")
SPACE_RE = re.compile(r"\s+")
WORD_RE = re.compile(r"[a-z0-9]+")


def canonicalize_url(url: str) -> str:
    parts = urlsplit(url.strip())
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=False) if not TRACKING_PARAMS.match(k)]
    path = parts.path.rstrip("/") or "/"
    host = parts.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    return urlunsplit((parts.scheme.lower() or "https", host, path, urlencode(sorted(query)), ""))


def clean_text(value: str | None, limit: int = 20000) -> str:
    if not value:
        return ""
    text = TAG_RE.sub(" ", value)
    text = html.unescape(text)
    return SPACE_RE.sub(" ", text).strip()[:limit]


def content_hash(title: str, text: str) -> str:
    words = WORD_RE.findall(f"{title} {text[:500]}".lower())
    return hashlib.sha1(" ".join(words).encode()).hexdigest()


def shingles(text: str, size: int = 3) -> set[str]:
    words = WORD_RE.findall(text.lower())
    if len(words) < size:
        return {" ".join(words)} if words else set()
    return {" ".join(words[i : i + size]) for i in range(len(words) - size + 1)}


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def domain_of(url: str) -> str:
    host = urlsplit(url).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def strip_outlet_suffix(title: str) -> tuple[str, str | None]:
    """Google News titles end in ' - Outlet Name'. Split it off."""
    if " - " in title:
        head, _, tail = title.rpartition(" - ")
        if head and len(tail) < 80:
            return head.strip(), tail.strip()
    return title, None
