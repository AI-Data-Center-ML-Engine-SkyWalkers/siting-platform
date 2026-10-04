"""Official records: state bills (Open States, LegiScan), federal notices (Federal Register)
and city/county council matters (Legistar)."""
from __future__ import annotations

import re
from datetime import datetime, timezone

import httpx

from ..base import Collector, RawItem, log, parse_dt
from ..keywords import FEDERAL_REGISTER_TERM, LEGISLATION_QUERY
from ..normalize import clean_text

OCD_STATE_RE = re.compile(r"/state:([a-z]{2})")


class OpenStatesCollector(Collector):
    """Open States API v3 (Plural Policy): bills in all 50 state legislatures."""

    name = "openstates"
    source_type = "legislation"
    interval_minutes = 360
    requires = ("openstates_api_key",)
    URL = "https://v3.openstates.org/bills"

    QUERIES = ('"data center"', '"AI data center"')

    async def collect(self, client: httpx.AsyncClient, since: datetime) -> list[RawItem]:
        items: list[RawItem] = []
        seen: set[str] = set()
        for query in self.QUERIES:
            for page in range(1, 6):
                params = [
                    ("q", query),
                    ("sort", "updated_desc"),
                    ("updated_since", since.strftime("%Y-%m-%d")),
                    ("per_page", "20"),
                    ("page", str(page)),
                    ("include", "abstracts"),
                    ("include", "sources"),
                ]
                response = await self.polite_get(
                    client, self.URL, params=params, headers={"X-API-KEY": self.settings.openstates_api_key}
                )
                if response.status_code == 400:
                    log.warning("openstates: HTTP 400 for %s: %s", query, response.text[:300])
                    break
                response.raise_for_status()
                data = response.json()
                for bill in data.get("results", []):
                    item = self.parse_bill(bill)
                    key = item.external_id or item.url
                    if key in seen:
                        continue
                    seen.add(key)
                    items.append(item)
                if page >= (data.get("pagination") or {}).get("max_page", 1):
                    break
        return items

    def parse_bill(self, b: dict) -> RawItem:
        jurisdiction = b.get("jurisdiction") or {}
        match = OCD_STATE_RE.search(jurisdiction.get("id", ""))
        abstracts = " ".join(a.get("abstract", "") for a in b.get("abstracts") or [])
        action = b.get("latest_action_description") or ""
        return RawItem(
            source=self.name,
            source_type=self.source_type,
            url=b.get("openstates_url") or b.get("id"),
            title=f"{b.get('identifier', '')}: {clean_text(b.get('title'))}".strip(": "),
            text=clean_text(f"{abstracts} Latest action ({b.get('latest_action_date')}): {action}"),
            published_at=parse_dt(b.get("latest_action_date") or b.get("updated_at")),
            external_id=b.get("id"),
            outlet=jurisdiction.get("name"),
            state=match.group(1).upper() if match else None,
            version_key=f"{b.get('latest_action_date')}|{action}"[:200],
            extra={
                "bill_number": b.get("identifier"),
                "session": b.get("session"),
                "latest_action": action,
                "latest_action_date": b.get("latest_action_date"),
                "latest_passage_date": b.get("latest_passage_date"),
            },
        )


class LegiScanCollector(Collector):
    """LegiScan full-text bill search across all states and Congress. Free tier: 10,000 queries/month,
    so this runs twice a day. Data licensed CC BY 4.0: credit LegiScan in the app."""

    name = "legiscan"
    source_type = "legislation"
    interval_minutes = 720
    requires = ("legiscan_api_key",)
    URL = "https://api.legiscan.com/"

    async def collect(self, client: httpx.AsyncClient, since: datetime) -> list[RawItem]:
        params = {"key": self.settings.legiscan_api_key, "op": "getSearch", "state": "ALL", "query": LEGISLATION_QUERY, "year": 2}
        response = await self.polite_get(client, self.URL, params=params)
        response.raise_for_status()
        data = response.json()
        if data.get("status") != "OK":
            raise RuntimeError(f"LegiScan: {data.get('alert', data)}")
        results = data.get("searchresult", {})
        items = []
        for key, bill in results.items():
            if key == "summary" or not isinstance(bill, dict):
                continue
            item = self.parse_bill(bill)
            if item.when() >= since:
                items.append(item)
        return items

    def parse_bill(self, b: dict) -> RawItem:
        state = (b.get("state") or "").upper()
        return RawItem(
            source=self.name,
            source_type=self.source_type,
            url=b.get("url") or b.get("research_url") or "",
            title=f"{state} {b.get('bill_number', '')}: {clean_text(b.get('title'))}",
            text=clean_text(f"Latest action ({b.get('last_action_date')}): {b.get('last_action', '')}"),
            published_at=parse_dt(b.get("last_action_date")),
            external_id=str(b.get("bill_id")),
            outlet="LegiScan",
            state=state if len(state) == 2 and state != "US" else None,
            version_key=b.get("change_hash"),
            extra={
                "bill_number": b.get("bill_number"),
                "latest_action": b.get("last_action"),
                "latest_action_date": b.get("last_action_date"),
                "text_url": b.get("text_url"),
                "relevance": b.get("relevance"),
            },
        )


class FederalRegisterCollector(Collector):
    """Federal Register: federal rules and notices. No key needed."""

    name = "federal_register"
    source_type = "government"
    interval_minutes = 1440
    URL = "https://www.federalregister.gov/api/v1/documents.json"

    async def collect(self, client: httpx.AsyncClient, since: datetime) -> list[RawItem]:
        params = {
            "conditions[term]": FEDERAL_REGISTER_TERM,
            "conditions[publication_date][gte]": since.strftime("%Y-%m-%d"),
            "order": "newest",
            "per_page": 100,
        }
        response = await self.polite_get(client, self.URL, params=params)
        response.raise_for_status()
        return [self.parse_doc(d) for d in response.json().get("results", [])]

    def parse_doc(self, d: dict) -> RawItem:
        agencies = ", ".join(a.get("name", "") for a in d.get("agencies") or [] if a.get("name"))
        return RawItem(
            source=self.name,
            source_type=self.source_type,
            url=d.get("html_url", ""),
            title=clean_text(d.get("title")),
            text=clean_text(d.get("abstract")),
            published_at=parse_dt(d.get("publication_date")),
            external_id=d.get("document_number"),
            outlet=agencies or "Federal Register",
            extra={"document_type": d.get("type"), "agencies": agencies},
        )


class LegistarCollector(Collector):
    """City and county council matters from Legistar (Granicus). Configure councils with
    LEGISTAR_CLIENTS=client|countyFIPS|ST,... Some councils require a token; those are skipped."""

    name = "legistar"
    source_type = "government"
    interval_minutes = 720

    def clients(self) -> list[tuple[str, str | None, str | None]]:
        out = []
        for spec in self.settings.csv(self.settings.legistar_clients):
            parts = [p.strip() for p in spec.split("|")]
            out.append((parts[0], parts[1] if len(parts) > 1 else None, parts[2].upper() if len(parts) > 2 else None))
        return out

    def enabled(self) -> bool:
        return bool(self.clients())

    async def collect(self, client: httpx.AsyncClient, since: datetime) -> list[RawItem]:
        items: list[RawItem] = []
        stamp = since.strftime("%Y-%m-%dT%H:%M:%S")
        odata_filter = (
            "(substringof('data center',MatterTitle) or substringof('datacenter',MatterTitle) "
            "or substringof('data center',MatterName)) "
            f"and MatterLastModifiedUtc ge datetime'{stamp}'"
        )
        for name, fips, state in self.clients():
            url = f"https://webapi.legistar.com/v1/{name}/matters"
            params = {"$filter": odata_filter, "$orderby": "MatterLastModifiedUtc desc", "$top": 100}
            response = await self.polite_get(client, url, params=params)
            if response.status_code != 200:
                log.warning("legistar: %s returned HTTP %s (token required?)", name, response.status_code)
                continue
            items.extend(self.parse_matter(m, name, fips, state) for m in response.json())
        return items

    def parse_matter(self, m: dict, client_name: str, fips: str | None, state: str | None) -> RawItem:
        url = f"https://{client_name}.legistar.com/LegislationDetail.aspx?ID={m.get('MatterId')}&GUID={m.get('MatterGuid')}"
        status = m.get("MatterStatusName") or ""
        return RawItem(
            source=self.name,
            source_type=self.source_type,
            url=url,
            title=clean_text(f"{m.get('MatterFile') or ''} {m.get('MatterName') or m.get('MatterTitle') or ''}"),
            text=clean_text(f"{m.get('MatterTitle') or ''} Status: {status}. Body: {m.get('MatterBodyName') or ''}."),
            published_at=parse_dt(m.get("MatterIntroDate") or m.get("MatterLastModifiedUtc")),
            external_id=f"{client_name}:{m.get('MatterId')}",
            outlet=f"{client_name} council (Legistar)",
            state=state,
            county_fips=fips,
            version_key=f"{status}|{m.get('MatterLastModifiedUtc')}",
            extra={"matter_type": m.get("MatterTypeName"), "status": status, "body": m.get("MatterBodyName")},
        )


async def probe_legistar(client_name: str) -> str:
    """Check that a Legistar client name exists and is open (used by the CLI)."""
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(f"https://webapi.legistar.com/v1/{client_name}/bodies", params={"$top": 5})
    if response.status_code == 200:
        bodies = ", ".join(b.get("BodyName", "?") for b in response.json())
        return f"OK: {client_name} is open. Bodies: {bodies}"
    return f"{client_name}: HTTP {response.status_code} ({response.text[:120]})"


