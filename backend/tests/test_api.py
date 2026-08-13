import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx

from backend.app.main import app, market_data
from backend.app.market_data.models import InstrumentSearchResult



async def get(path: str) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(path)


async def post(path: str) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.post(path)


def test_health() -> None:
    response = asyncio.run(get("/api/health"))
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["phase"] == "stable"
    assert payload["version"] == "1.0.2"
    assert payload["revision"]


def test_demo_snapshot() -> None:
    response = asyncio.run(get("/api/demo/snapshot/001280"))
    assert response.status_code == 200
    payload = response.json()
    assert payload["instrument"]["symbol"] == "001280"
    assert payload["instrument"]["adjustment"] == "qfq"
    assert payload["realtime"] is False


def test_market_provider_status_exposes_priority_order() -> None:
    response = asyncio.run(get("/api/market/providers"))
    assert response.status_code == 200
    payload = response.json()
    assert [item["name"] for item in payload] == ["tencent-public", "yahoo-chart"]
    assert [item["priority"] for item in payload] == [1, 2]


def test_resolve_a_share() -> None:
    response = asyncio.run(get("/api/instruments/resolve?input=001280"))
    assert response.status_code == 200
    assert response.json()["key"] == "SZSE:001280"


def test_resolve_hong_kong_share() -> None:
    response = asyncio.run(get("/api/instruments/resolve?input=00700.HK"))
    assert response.status_code == 200
    assert response.json()["provider_symbol"] == "hk00700"


def test_search_instruments_returns_ranked_suggestions_without_loading_a_chart() -> None:
    suggestion = InstrumentSearchResult(
        input="sh600988", symbol="600988", name="赤峰黄金", market="CN",
        exchange="SSE", provider_symbol="sh600988", asset_type="stock",
    )
    with patch.object(market_data, "search_instruments", AsyncMock(return_value=[suggestion])) as search:
        response = asyncio.run(get("/api/instruments/search?q=赤峰黄金&limit=5"))

    assert response.status_code == 200
    assert response.json()[0]["input"] == "sh600988"
    search.assert_awaited_once_with("赤峰黄金", 5)


def test_project_export_returns_a_browser_download_url(tmp_path) -> None:
    archive = tmp_path / "stock-dashboard.zip"
    archive.write_bytes(b"zip")
    with patch("backend.app.main.journal.export_project", return_value=archive), patch(
        "backend.app.main.settings", SimpleNamespace(data_dir=tmp_path)
    ):
        response = asyncio.run(post("/api/journal/export-project"))

    assert response.status_code == 200
    assert response.json() == {
        "path": str(archive),
        "download_url": "/api/journal/artifact?path=stock-dashboard.zip",
        "filename": "stock-dashboard.zip",
    }
