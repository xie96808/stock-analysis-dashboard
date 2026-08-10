import asyncio

import httpx

from backend.app.main import app



async def get(path: str) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(path)


def test_health() -> None:
    response = asyncio.run(get("/api/health"))
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["phase"] == "stable"
    assert payload["version"] == "1.0.2"


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
