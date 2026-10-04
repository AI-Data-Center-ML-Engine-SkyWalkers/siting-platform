"""Registry of all collectors. Add a new source by writing a Collector and listing it here."""
from .government import FederalRegisterCollector, LegiScanCollector, LegistarCollector, OpenStatesCollector
from .news import GdeltCollector, GoogleNewsCollector, MediaCloudCollector, RssCollector
from .social import BlueskySearchCollector, JetstreamListener, MastodonCollector, RedditCollector

COLLECTOR_CLASSES = [
    OpenStatesCollector,
    LegiScanCollector,
    FederalRegisterCollector,
    LegistarCollector,
    GdeltCollector,
    MediaCloudCollector,
    GoogleNewsCollector,
    RssCollector,
    BlueskySearchCollector,
    RedditCollector,
    MastodonCollector,
]


def build_collectors(settings) -> dict:
    return {cls.name: cls(settings) for cls in COLLECTOR_CLASSES}


__all__ = ["COLLECTOR_CLASSES", "JetstreamListener", "build_collectors"]
