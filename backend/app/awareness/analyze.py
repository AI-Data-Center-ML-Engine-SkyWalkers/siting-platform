"""AI analysis of scraped items: Gemini first, Claude as fallback, keyword rules last.

The model sees only the item's own text and must quote the sentence it relied on.
Quotes that are not found in the source are flagged, and confidence is cut.
"""
from __future__ import annotations

import difflib
import json
import re
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

from .base import log

Stance = Literal["support", "oppose", "neutral", "mixed"]
Topic = Literal[
    "power_bills", "grid_reliability", "water", "noise", "air_quality", "tax_breaks", "zoning_land_use",
    "farmland", "transparency", "jobs_economy", "property_values", "heat_reuse", "renewables",
    "traffic_construction", "environment_climate",
]
EventType = Literal[
    "protest", "public_hearing", "zoning_decision", "bill_introduced", "bill_advanced", "bill_passed",
    "moratorium", "restriction", "incentive", "lawsuit", "project_announced", "project_approved",
    "project_canceled", "opinion", "other",
]

TOPIC_LABELS = {
    "power_bills": "Electricity bills", "grid_reliability": "Grid reliability", "water": "Water use",
    "noise": "Noise", "air_quality": "Air quality and generators", "tax_breaks": "Tax breaks",
    "zoning_land_use": "Zoning and land use", "farmland": "Farmland loss", "transparency": "Transparency",
    "jobs_economy": "Jobs and local economy", "property_values": "Property values", "heat_reuse": "Heat reuse",
    "renewables": "Renewable energy", "traffic_construction": "Traffic and construction",
    "environment_climate": "Environment and climate",
}


class ItemAnalysis(BaseModel):
    ref: int = Field(description="The [ref] number of the item")
    relevant: bool = Field(description="True only if about a US data center, data center policy, or reaction to one")
    stance: Stance = Field(description="Position toward building data centers in that place")
    topics: list[Topic] = Field(default_factory=list, description="Issues raised, most important first (max 4)")
    event_type: EventType
    severity: int = Field(ge=1, le=5, description="5 = moratorium enacted, project canceled or law passed; 1 = passing mention")
    state: str | None = Field(default=None, description="Two-letter US state code, or null")
    county: str | None = Field(default=None, description="County name without the word County, or null")
    city: str | None = None
    summary: str = Field(description="One plain-English sentence for a site planner")
    evidence: str = Field(description="One sentence or phrase copied VERBATIM from the item (max 30 words)")
    companies: list[str] = Field(default_factory=list)
    bill_number: str | None = None
    event_date: str | None = Field(default=None, description="YYYY-MM-DD of a stated upcoming hearing, vote or protest")
    confidence: float = Field(ge=0, le=1)


class BatchAnalysis(BaseModel):
    items: list[ItemAnalysis]


SYSTEM_PROMPT = """You analyze public information about data center projects in the United States for site planners and real estate developers.

For every numbered item, return one analysis object:
- relevant: true only if the item is about a specific or proposed US data center or AI data center, data center policy (tax incentives, moratoria, zoning, utility rates), or community reaction to data centers. Generic AI product, stock-market, or hashtag-only tech posts are not relevant.
- stance: the item's position toward building data centers in that place. support, oppose, neutral (factual reporting), or mixed.
- topics: the issues raised, most important first, at most 4.
- event_type: what happened. Use bill_* for legislation, zoning_decision for a local land-use vote, opinion for commentary without a new event.
- severity 1-5: how much this changes the risk or appeal of building there. 5 = moratorium enacted, project canceled, law passed. 3 = hearing scheduled, bill advancing, organized opposition. 1 = passing mention.
- state, county, city: where it happens, if stated in the item.
- summary: one plain-English sentence a site planner can act on.
- evidence: copy one sentence or phrase VERBATIM from the item that supports your stance and event_type. Never paraphrase.
- companies, bill_number, event_date (YYYY-MM-DD only for an upcoming dated hearing, vote or protest).
- confidence 0-1.

Use only the text of each item. Do not add facts from outside knowledge. Social posts express one person's view: mark them opinion unless they report a concrete event."""


def build_prompt(items: list[dict]) -> str:
    blocks = []
    for i, it in enumerate(items):
        blocks.append(
            f"[ref {i}] source type: {it['source_type']} ({it.get('outlet') or it['source']}), "
            f"published {it.get('published', 'unknown')}\n"
            f"Title: {it.get('title') or '(none)'}\nText: {it.get('text') or '(none)'}"
        )
    return "Analyze these items:\n\n" + "\n\n".join(blocks)


def inline_schema(model: type[BaseModel]) -> dict:
    """Inline $defs/$ref so every provider accepts the schema."""
    schema = model.model_json_schema()
    defs = schema.pop("$defs", {})

    def resolve(node):
        if isinstance(node, dict):
            if "$ref" in node:
                return resolve(defs[node["$ref"].split("/")[-1]])
            return {k: resolve(v) for k, v in node.items() if k != "title"}
        if isinstance(node, list):
            return [resolve(v) for v in node]
        return node

    return resolve(schema)


# ---------- Evidence check ----------
_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-"})


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").translate(_QUOTES).lower()).strip()


PUNCT_ONLY = re.compile(r"^[\s.!?'\"“”‘’…]+$")


def usable_text(value: str | None) -> bool:
    return bool(value and value.strip() and not PUNCT_ONLY.fullmatch(value.strip()))


def usable_sentences(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"(?<=[.!?])\s+", text or "") if usable_text(part)]


def evidence_found(evidence: str, source_text: str) -> bool:
    ev, src = _norm(evidence).strip(" .\"'"), _norm(source_text)
    if len(ev) < 8:
        return False
    if ev in src:
        return True
    match = difflib.SequenceMatcher(None, ev, src, autojunk=False).find_longest_match(0, len(ev), 0, len(src))
    return match.size / len(ev) >= 0.8


# ---------- Providers ----------
class GeminiProvider:
    name = "gemini"

    def __init__(self, settings):
        from google import genai

        self.model = settings.gemini_model
        self.client = genai.Client(api_key=settings.gemini_api_key)

    async def analyze(self, items: list[dict]) -> list[ItemAnalysis]:
        from google.genai import types

        response = await self.client.aio.models.generate_content(
            model=self.model,
            contents=build_prompt(items),
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                response_mime_type="application/json",
                response_json_schema=inline_schema(BatchAnalysis),
                temperature=0.1,
            ),
        )
        return BatchAnalysis.model_validate_json(response.text).items


class ClaudeProvider:
    name = "claude"

    def __init__(self, settings):
        import anthropic

        self.model = settings.claude_model
        self.client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    async def analyze(self, items: list[dict]) -> list[ItemAnalysis]:
        message = await self.client.messages.create(
            model=self.model,
            max_tokens=8000,
            system=SYSTEM_PROMPT,
            tools=[{
                "name": "record_analysis",
                "description": "Record the analysis of every item.",
                "input_schema": inline_schema(BatchAnalysis),
            }],
            tool_choice={"type": "tool", "name": "record_analysis"},
            messages=[{"role": "user", "content": build_prompt(items)}],
        )
        for block in message.content:
            if block.type == "tool_use":
                return BatchAnalysis.model_validate(block.input).items
        raise RuntimeError("Claude returned no tool call")


class RulesProvider:
    """Keyword rules. Always available, so the pipeline runs without any API key."""

    name = "rules"
    model = "keyword-rules-v1"

    OPPOSE = re.compile(r"\b(oppos\w*|against|protest\w*|moratorium|ban(?:ned|s)?|lawsuit|sue[sd]?|petition\w*|halt\w*|reject\w*|denied|deny|fight\w*|concern\w*|worr\w*|outrage\w*|pause[sd]?)\b", re.I)
    SUPPORT = re.compile(r"\b(approv\w*|welcom\w*|incentive\w*|tax (?:break|exemption|credit)s?|abatement|investment|jobs?|boost\w*|support\w*|partnership|break(?:s)? ground)\b", re.I)
    TOPICS = {
        "power_bills": r"electric(?:ity)? (?:bill|rate)s?|power bills?|utility rates?|ratepayers?",
        "grid_reliability": r"\bgrid\b|transmission|blackouts?|substations?",
        "water": r"\bwater\b|aquifer|drought",
        "noise": r"\bnoise|\bhum\b|decibel",
        "air_quality": r"diesel|generators?|turbines?|emissions|air quality|pollution",
        "tax_breaks": r"tax (?:break|exemption|credit|incentive)s?|abatement|subsid",
        "zoning_land_use": r"zoning|rezon\w*|land use|comprehensive plan|ordinance",
        "farmland": r"farmland|agricultural land|farms?\b",
        "transparency": r"non-?disclosure|\bNDA\b|secrecy|transparen",
        "jobs_economy": r"\bjobs?\b|employment|economic|tax revenue",
        "property_values": r"property values?|home values?",
        "heat_reuse": r"waste heat|heat reuse|district heating",
        "renewables": r"solar|wind|renewable|nuclear",
        "traffic_construction": r"traffic|construction trucks|road",
        "environment_climate": r"climate|carbon|wildlife|environment",
    }
    EVENTS = [
        ("moratorium", r"moratorium"),
        ("project_canceled", r"cancel+ed|withdr[ae]wn?|scrapped|pulls? out|abandon"),
        ("lawsuit", r"lawsuit|\bsues?\b|\bsued\b|court"),
        ("protest", r"protest|rally|march(?:ed)?\b"),
        ("public_hearing", r"public hearing|hearing on|town hall|public comment"),
        ("zoning_decision", r"rezon\w*|zoning (?:board|commission|vote)|planning commission|board of supervisors vot"),
        ("incentive", r"tax (?:break|exemption|credit|incentive)|abatement"),
        ("project_approved", r"\bapproved\b"),
        ("project_announced", r"announc\w*|plans? to build|proposed|unveil"),
    ]

    async def analyze(self, items: list[dict]) -> list[ItemAnalysis]:
        return [self.analyze_one(i, it) for i, it in enumerate(items)]

    def analyze_one(self, ref: int, it: dict) -> ItemAnalysis:
        from .keywords import is_data_center_news

        title = (it.get("title") or "").strip()
        body = (it.get("text") or "").strip()
        text = " ".join(part for part in (title, body) if part)
        oppose = len(self.OPPOSE.findall(text))
        support = len(self.SUPPORT.findall(text))
        stance = "neutral"
        if oppose and support:
            stance = "oppose" if oppose >= 2 * support else "support" if support >= 2 * oppose else "mixed"
        elif oppose:
            stance = "oppose"
        elif support:
            stance = "support"
        topics = [t for t, pat in self.TOPICS.items() if re.search(pat, text, re.I)][:4]
        event = "opinion" if it.get("source_type") == "social" else "other"
        if it.get("source_type") == "legislation":
            event = "bill_passed" if re.search(r"signed|enacted|chaptered|passed both", text, re.I) else "bill_introduced"
        for name, pat in self.EVENTS:
            if re.search(pat, text, re.I) and not (it.get("source_type") == "legislation" and name in ("project_announced", "project_approved")):
                event = name
                break
        if event == "moratorium" and re.search(r"\b(vote|consider\w*|propos\w*|weigh\w*|hearing|debat\w*|could|may)\b", text, re.I):
            event = "restriction"  # a proposed moratorium is not an enacted one
        severity = {"moratorium": 5, "restriction": 3, "project_canceled": 5, "bill_passed": 4, "lawsuit": 4, "zoning_decision": 4,
                    "protest": 3, "public_hearing": 3, "incentive": 3, "bill_introduced": 3, "project_approved": 3,
                    "project_announced": 2}.get(event, 1)
        sentences = usable_sentences(text)
        pattern = self.OPPOSE if stance == "oppose" else self.SUPPORT
        headline = title or (sentences[0] if sentences else "")
        evidence = next((s for s in sentences if pattern.search(s)), sentences[0] if sentences else headline)
        return ItemAnalysis(
            ref=ref,
            relevant=is_data_center_news(text),
            stance=stance,
            topics=topics,
            event_type=event,
            severity=severity,
            state=it.get("state"),
            summary=headline[:240],
            evidence=" ".join(evidence.split()[:30]),
            confidence=0.4,
        )


@dataclass
class AnalysisResult:
    item_id: int
    analysis: ItemAnalysis
    provider: str
    model: str
    evidence_verified: bool


class Analyzer:
    """Runs batches through the provider chain, falling back when a provider fails."""

    def __init__(self, settings):
        self.settings = settings
        self.providers = []
        if settings.gemini_api_key:
            try:
                self.providers.append(GeminiProvider(settings))
            except Exception as exc:  # missing package or bad key format
                log.warning("Gemini unavailable: %s", exc)
        if settings.anthropic_api_key:
            try:
                self.providers.append(ClaudeProvider(settings))
            except Exception as exc:
                log.warning("Claude unavailable: %s", exc)
        self.providers.append(RulesProvider())

    @property
    def chain(self) -> list[str]:
        return [p.name for p in self.providers]

    async def analyze(self, items: list[dict]) -> list[AnalysisResult]:
        """items: dicts with id, source, source_type, outlet, title, text, published, state."""
        size = max(1, self.settings.analysis_batch_size)
        results: list[AnalysisResult] = []
        for start in range(0, len(items), size):
            batch = items[start : start + size]
            for provider in self.providers:
                try:
                    analyses = await provider.analyze(batch)
                except (ValidationError, json.JSONDecodeError) as exc:
                    log.warning("%s returned invalid JSON: %s", provider.name, str(exc)[:200])
                    continue
                except Exception as exc:  # rate limits, network, auth
                    log.warning("%s failed, falling back: %s", provider.name, str(exc)[:200])
                    continue
                by_ref = {a.ref: a for a in analyses if 0 <= a.ref < len(batch)}
                rules = RulesProvider()
                for ref, it in enumerate(batch):
                    analysis, name, model = by_ref.get(ref), provider.name, getattr(provider, "model", "")
                    if analysis is None:  # the model skipped an item
                        analysis, name, model = rules.analyze_one(ref, it), rules.name, rules.model
                    if not usable_text(analysis.summary) or not usable_text(analysis.evidence):
                        fallback = rules.analyze_one(ref, it)
                        if not usable_text(analysis.summary):
                            analysis.summary = fallback.summary
                        if not usable_text(analysis.evidence):
                            analysis.evidence = fallback.evidence
                    verified = evidence_found(analysis.evidence, f"{it.get('title') or ''} {it.get('text') or ''}")
                    if not verified:
                        analysis.confidence = round(analysis.confidence * 0.5, 3)
                    results.append(AnalysisResult(it["id"], analysis, name, model, verified))
                break
        return results
