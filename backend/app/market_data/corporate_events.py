from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from .symbols import normalize_symbol


EASTMONEY_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get"


def _date_only(value: str | None) -> str | None:
    if not value:
        return None
    text = str(value).strip()[:10]
    return text if len(text) == 10 and text[4] == "-" and text[7] == "-" else None


def _shanghai_today() -> str:
    return datetime.now(ZoneInfo("Asia/Shanghai")).date().isoformat()


def _pick_next(rows: list[dict[str, Any]], date_key: str, today: str) -> dict[str, Any] | None:
    upcoming: list[tuple[str, dict[str, Any]]] = []
    for row in rows:
        date = _date_only(row.get(date_key))
        if date and date >= today:
            upcoming.append((date, row))
    if not upcoming:
        return None
    upcoming.sort(key=lambda item: item[0])
    return upcoming[0][1]


class CorporateEventService:
    def __init__(self, timeout_seconds: float = 8.0, client: httpx.AsyncClient | None = None):
        self._owns_client = client is None
        self.client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_seconds, connect=min(2.5, timeout_seconds)),
            trust_env=False,
            headers={"User-Agent": "stock-analysis-dashboard/1.0"},
        )
        self._cache: dict[str, tuple[float, dict[str, Any]]] = {}

    async def close(self) -> None:
        if self._owns_client:
            await self.client.aclose()

    async def _get(self, params: dict[str, str]) -> list[dict[str, Any]]:
        response = await self.client.get(EASTMONEY_URL, params=params)
        response.raise_for_status()
        payload = response.json()
        if not payload.get("success"):
            return []
        rows = (payload.get("result") or {}).get("data") or []
        return rows if isinstance(rows, list) else []

    async def events_for(self, raw_symbol: str) -> dict[str, Any]:
        instrument = normalize_symbol(raw_symbol)
        empty = {"instrument": {"symbol": instrument.symbol, "market": instrument.market}, "events": []}
        if instrument.market != "CN":
            return empty
        cached = self._cache.get(instrument.symbol)
        now = datetime.now(UTC).timestamp()
        if cached and now - cached[0] < 6 * 3600:
            return cached[1]
        today = _shanghai_today()
        events: list[dict[str, str]] = []
        try:
            dividends = await self._get({
                "reportName": "RPT_SHAREBONUS_DET",
                "columns": "SECURITY_CODE,EX_DIVIDEND_DATE,EQUITY_RECORD_DATE,IMPL_PLAN_PROFILE",
                "filter": f'(SECURITY_CODE="{instrument.symbol}")',
                "pageNumber": "1",
                "pageSize": "20",
                "sortTypes": "-1",
                "sortColumns": "EX_DIVIDEND_DATE",
                "source": "WEB",
                "client": "WEB",
            })
            row = _pick_next(dividends, "EX_DIVIDEND_DATE", today)
            if row:
                date = _date_only(row.get("EX_DIVIDEND_DATE"))
                plan = str(row.get("IMPL_PLAN_PROFILE") or "分红").strip()
                if date:
                    events.append({"kind": "dividend", "date": date, "label": f"分红 {plan}"[:18]})
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            pass
        try:
            reports = await self._get({
                "reportName": "RPT_PUBLIC_BS_APPOIN",
                "columns": "SECURITY_CODE,APPOINT_PUBLISH_DATE,ACTUAL_PUBLISH_DATE,REPORT_TYPE_NAME,IS_PUBLISH",
                "filter": f'(SECURITY_CODE="{instrument.symbol}")',
                "pageNumber": "1",
                "pageSize": "20",
                "sortTypes": "-1",
                "sortColumns": "APPOINT_PUBLISH_DATE",
                "source": "WEB",
                "client": "WEB",
            })
            row = _pick_next(reports, "APPOINT_PUBLISH_DATE", today)
            if row:
                date = _date_only(row.get("APPOINT_PUBLISH_DATE"))
                name = str(row.get("REPORT_TYPE_NAME") or "业绩").strip()
                if date:
                    events.append({"kind": "earnings", "date": date, "label": name[:18]})
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            pass
        result = {"instrument": {"symbol": instrument.symbol, "market": instrument.market}, "events": events}
        self._cache[instrument.symbol] = (now, result)
        return result
