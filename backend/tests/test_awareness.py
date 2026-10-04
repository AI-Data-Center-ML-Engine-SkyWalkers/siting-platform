"""Offline tests: parsers use recorded-shape payloads, the pipeline runs with keyword rules (no API keys)."""
import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.awareness.analyze import RulesProvider, evidence_found
from app.awareness.keywords import is_data_center_news, mentions_data_center
from app.awareness.base import RawItem
from app.awareness.geo import geotag, state_from_text
from app.awareness.normalize import canonicalize_url
from app.awareness.pipeline import Pipeline
from app.awareness.sources.government import LegiScanCollector, OpenStatesCollector
from app.awareness.sources.news import GdeltCollector, GoogleNewsCollector
from app.awareness.sources.social import BlueskySearchCollector, JetstreamListener
from app.config import Settings
from app.db import Base

NOW = datetime.now(timezone.utc)


@pytest.fixture
def settings():
    return Settings(_env_file=None, database_url="sqlite://", gemini_api_key=None, anthropic_api_key=None, enrich_article_text=False)


@pytest.fixture
def pipeline(settings):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, future=True,
                           poolclass=__import__("sqlalchemy.pool", fromlist=["StaticPool"]).StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    return Pipeline(settings, session_factory=factory)


def test_canonical_url_strips_tracking():
    assert canonicalize_url("https://www.Example.com/a/?utm_source=x&id=2&fbclid=9#top") == "https://example.com/a?id=2"


def test_geotag_county_and_state():
    state, fips, method = geotag("The Loudoun County Board of Supervisors in Virginia voted on the rezoning.")
    assert (state, fips, method) == ("VA", "51107", "gazetteer")
    assert state_from_text("Residents in Ashburn, VA packed the hearing") == "VA"
    assert state_from_text("West Virginia lawmakers") == "WV"


def test_evidence_check():
    text = "Residents asked the county to pause all new data center applications for a year."
    assert evidence_found("pause all new data center applications", text)
    assert not evidence_found("the governor signed a tax exemption", text)


def test_gdelt_parse():
    a = {"url": "https://news.example.com/story?utm_source=gdelt", "title": "County weighs data center moratorium",
         "seendate": "20261002T141500Z", "domain": "news.example.com", "language": "English", "sourcecountry": "United States"}
    item = GdeltCollector(None).parse(a)
    assert item.published_at == datetime(2026, 10, 2, 14, 15, tzinfo=timezone.utc)
    assert item.outlet == "news.example.com"


def test_google_news_parse():
    xml = """<?xml version="1.0"?><rss><channel><item>
      <title>Planning board rejects data center rezoning - The Daily Example</title>
      <link>https://news.google.com/rss/articles/abc</link>
      <pubDate>Thu, 01 Oct 2026 12:00:00 GMT</pubDate>
      <source url="https://dailyexample.com">The Daily Example</source>
    </item></channel></rss>"""
    items = GoogleNewsCollector(None).parse_feed(xml)
    assert items[0].title == "Planning board rejects data center rezoning"
    assert items[0].outlet == "The Daily Example"


def test_openstates_parse():
    bill = {"id": "ocd-bill/1", "identifier": "HB 1234", "title": "Data center sales tax exemption; sunset",
            "jurisdiction": {"id": "ocd-jurisdiction/country:us/state:va/government", "name": "Virginia"},
            "latest_action_date": "2026-09-30", "latest_action_description": "Referred to Finance",
            "openstates_url": "https://openstates.org/va/bills/2026/HB1234/", "abstracts": [{"abstract": "Extends the exemption."}]}
    item = OpenStatesCollector(None).parse_bill(bill)
    assert item.state == "VA" and item.title.startswith("HB 1234")
    assert item.version_key.startswith("2026-09-30")


def test_legiscan_parse():
    b = {"state": "GA", "bill_number": "SB 34", "bill_id": 99, "change_hash": "abc", "url": "https://legiscan.com/GA/bill/SB34/2026",
         "last_action_date": "2026-09-01", "last_action": "Signed by Governor", "title": "Data center electricity cost protections"}
    item = LegiScanCollector(None).parse_bill(b)
    assert item.state == "GA" and item.version_key == "abc"


def test_bluesky_parse():
    post = {"uri": "at://did:plc:abc/app.bsky.feed.post/3kxyz", "author": {"handle": "someone.bsky.social"},
            "record": {"text": "Huge turnout against the data center tonight", "createdAt": "2026-10-02T23:00:00Z"}, "likeCount": 4}
    item = BlueskySearchCollector(None).parse_post(post)
    assert item.url == "https://bsky.app/profile/someone.bsky.social/post/3kxyz"


def test_jetstream_filter():
    event = {"did": "did:plc:abc", "time_us": 1, "kind": "commit", "commit": {"operation": "create", "collection": "app.bsky.feed.post",
             "rkey": "3k1", "record": {"text": "New data center proposed near the river", "langs": ["en"], "createdAt": "2026-10-02T23:00:00Z"}}}
    assert JetstreamListener.parse_event(event).url.endswith("/post/3k1")
    event["commit"]["record"]["text"] = "Lovely sunset"
    assert JetstreamListener.parse_event(event) is None


def test_data_center_news_gate():
    assert is_data_center_news("Utah survey shows most oppose a new data center")
    assert is_data_center_news("County pauses AI data center applications pending a state study")
    assert mentions_data_center("Gemini app cuts free access # DataCenters # AIEthics")
    assert not is_data_center_news("Gemini app cuts free access # DataCenters # AIEthics")
    assert not is_data_center_news("Stock market rallies on chip earnings")


def test_rules_provider_classifies():
    r = RulesProvider().analyze_one(0, {"title": "Residents protest data center plan over water use", "text": "", "source_type": "news"})
    assert r.relevant and r.stance == "oppose" and r.event_type == "protest" and "water" in r.topics


def test_rules_provider_empty_title_not_dot():
    r = RulesProvider().analyze_one(0, {
        "title": "",
        "text": "Trump Promotes Data Centers at Rally With Republican Facing Heat on Them https://www.nytimes.com/story",
        "source_type": "social",
    })
    assert r.summary.startswith("Trump Promotes Data Centers")
    assert r.evidence.startswith("Trump Promotes Data Centers")


def test_pipeline_end_to_end(pipeline):
    raws = [
        RawItem("gdelt", "news", "https://a.example.com/1", "Loudoun County residents protest data center over noise",
                "Hundreds of residents in Loudoun County, Virginia protested the data center, citing noise and power bills.", NOW - timedelta(days=1)),
        RawItem("rss", "news", "https://b.example.com/2", "Loudoun County residents protest data center over noise",
                "Residents in Loudoun County, Virginia rallied against a proposed data center.", NOW - timedelta(days=1)),
        RawItem("openstates", "legislation", "https://openstates.org/va/bills/2026/HB1/", "HB 1: Data center moratorium",
                "Establishes a moratorium on new data centers in Loudoun County. Latest action: passed House.",
                NOW - timedelta(days=2), state="VA"),
        RawItem("gdelt", "news", "https://c.example.com/3", "Stock market rallies on chip earnings", "Nothing about siting."),
        RawItem("mastodon", "social", "https://d.example.com/4", "Gemini app cutting model access # DataCenters # AIEthics",
                "Flash-Lite only now. # DataCenters"),
    ]
    inserted, updated = pipeline.ingest(raws)
    assert len(inserted) == 3  # off-topic and hashtag-only posts dropped by the keyword gate
    report = asyncio.run(pipeline.process_pending())
    assert report["analyzed"] >= 2 and report["providers"] == ["rules"]
    with pipeline.session_factory() as s:
        counties, states = pipeline.features.compute(s)
        f = counties["51107"]
        assert f.opposition_index > 0 and f.coverage >= 2
        assert f.active_moratorium  # official source, moratorium, severity 5
    # Same bill with a new status is updated, not duplicated
    raws[2].version_key = "passed-senate"
    _, updated = pipeline.ingest([raws[2]])
    assert len(updated) == 1
