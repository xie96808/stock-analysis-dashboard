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
    assert payload["phase"] == "P1"
    assert payload["version"] == "0.2.0-p1"


def test_demo_snapshot() -> None:
    response = asyncio.run(get("/api/demo/snapshot/001280"))
    assert response.status_code == 200
    payload = response.json()
    assert payload["instrument"]["symbol"] == "001280"
    assert payload["instrument"]["adjustment"] == "qfq"
    assert payload["realtime"] is False
