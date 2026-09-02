import asyncio
from unittest.mock import patch

import httpx

from backend.app.main import app
from backend.app.market_data.corporate_events import CorporateEventService, _pick_next


def test_pick_next_returns_the_soonest_future_date() -> None:
    row = _pick_next(
        [
            {"EX_DIVIDEND_DATE": "2026-08-01"},
            {"EX_DIVIDEND_DATE": "2026-09-12"},
            {"EX_DIVIDEND_DATE": "2026-09-05"},
        ],
        "EX_DIVIDEND_DATE",
        "2026-09-01",
    )
    assert row is not None
    assert row["EX_DIVIDEND_DATE"] == "2026-09-05"


def test_pick_next_skips_dates_without_a_calendar_day() -> None:
    assert _pick_next([{"EX_DIVIDEND_DATE": None}, {"EX_DIVIDEND_DATE": "soon"}], "EX_DIVIDEND_DATE", "2026-09-01") is None


class FakeClient:
    def __init__(self, by_report: dict[str, dict]) -> None:
        self.by_report = by_report
        self.calls: list[str] = []

    async def get(self, url: str, params: dict[str, str] | None = None) -> httpx.Response:
        report = (params or {}).get("reportName", "")
        self.calls.append(report)
        payload = self.by_report[report]
        return httpx.Response(200, json=payload, request=httpx.Request("GET", url))


def test_hong_kong_events_are_empty_without_fetching() -> None:
    client = FakeClient({})
    service = CorporateEventService(client=client)
    result = asyncio.run(service.events_for("00700.HK"))
    assert result["events"] == []
    assert result["instrument"]["market"] == "HK"
    assert client.calls == []


def test_picks_the_next_official_dividend_and_earnings_dates() -> None:
    client = FakeClient({
        "RPT_SHAREBONUS_DET": {
            "success": True,
            "result": {
                "data": [
                    {"EX_DIVIDEND_DATE": "2026-08-01", "IMPL_PLAN_PROFILE": "10派1"},
                    {"EX_DIVIDEND_DATE": "2026-09-12", "IMPL_PLAN_PROFILE": "10派2"},
                ]
            },
        },
        "RPT_PUBLIC_BS_APPOIN": {
            "success": True,
            "result": {
                "data": [
                    {"APPOINT_PUBLISH_DATE": "2026-10-20", "REPORT_TYPE_NAME": "三季报"},
                ]
            },
        },
    })
    service = CorporateEventService(client=client)
    with patch("backend.app.market_data.corporate_events._shanghai_today", return_value="2026-09-01"):
        result = asyncio.run(service.events_for("001280"))
    assert [item["kind"] for item in result["events"]] == ["dividend", "earnings"]
    assert result["events"][0]["date"] == "2026-09-12"
    assert "10派2" in result["events"][0]["label"]
    assert result["events"][1]["date"] == "2026-10-20"
    assert result["events"][1]["label"] == "三季报"


def test_failed_eastmoney_lookup_returns_empty_events() -> None:
    class BrokenClient:
        async def get(self, url: str, params: dict[str, str] | None = None) -> httpx.Response:
            raise httpx.ConnectError("offline")

    service = CorporateEventService(client=BrokenClient())  # type: ignore[arg-type]
    with patch("backend.app.market_data.corporate_events._shanghai_today", return_value="2026-09-01"):
        result = asyncio.run(service.events_for("001280"))
    assert result["events"] == []
    assert result["instrument"]["symbol"] == "001280"


async def _get(path: str) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(path)


def test_events_api_returns_empty_for_hong_kong() -> None:
    response = asyncio.run(_get("/api/market/events/00700.HK"))
    assert response.status_code == 200
    assert response.json()["events"] == []
