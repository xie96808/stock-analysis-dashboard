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
    assert payload["phase"] == "P2"
    assert payload["version"] == "0.3.0-p2"


def test_demo_snapshot() -> None:
    response = asyncio.run(get("/api/demo/snapshot/001280"))
    assert response.status_code == 200
    payload = response.json()
    assert payload["instrument"]["symbol"] == "001280"
    assert payload["instrument"]["adjustment"] == "qfq"
    assert payload["realtime"] is False


def test_resolve_a_share() -> None:
    response = asyncio.run(get("/api/instruments/resolve?input=001280"))
    assert response.status_code == 200
    assert response.json()["key"] == "SZSE:001280"


def test_resolve_hong_kong_share() -> None:
    response = asyncio.run(get("/api/instruments/resolve?input=00700.HK"))
    assert response.status_code == 200
    assert response.json()["provider_symbol"] == "hk00700"
