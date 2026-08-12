#!/usr/bin/env python3
"""Build the browser-side A-share/ETF/HK instrument index.

The generated artifact contains identifiers and short names only. Runtime
search is local; the existing Tencent smartbox remains a fallback for newly
listed or temporarily missing instruments.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "instrument-index.json"
URL = "https://push2delay.eastmoney.com/api/qt/clist/get"
PAGE_SIZE = 100
MINIMUM_INSTRUMENTS = 8_000
REQUIRED_SYMBOLS = {"sh516080", "sz159001", "bj920992", "hk00700"}
MARKETS = [
    ("a-stock", "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23"),
    ("b-stock", "m:0+t:81+s:2048,m:0+t:81+s:4096"),
    ("etf", "m:0+t:10,b:MK0021,b:MK0022,b:MK0023,b:MK0024"),
    ("hk", "m:116+t:3,m:116+t:4"),
]


def convert(row: dict[str, Any], kind: str) -> dict[str, str] | None:
    code = str(row.get("f12") or "").strip()
    name = str(row.get("f14") or "").strip()
    if not code or not name:
        return None
    if kind == "hk":
        symbol = code.zfill(5)
        return {
            "input": f"hk{symbol}", "symbol": symbol, "name": name, "market": "HK",
            "exchange": "HKEX", "provider_symbol": f"hk{symbol}", "asset_type": "stock",
        }
    exchange = "BSE" if kind == "b-stock" or code.startswith(("4", "8")) or code.startswith("92") else "SSE" if code.startswith(("5", "6", "9")) else "SZSE"
    prefix = "sh" if exchange == "SSE" else "sz" if exchange == "SZSE" else "bj"
    return {
        "input": f"{prefix}{code}", "symbol": code, "name": name, "market": "CN",
        "exchange": exchange, "provider_symbol": f"{prefix}{code}",
        "asset_type": "etf" if kind == "etf" else "stock",
    }


async def fetch_market(client: httpx.AsyncClient, kind: str, selector: str) -> list[dict[str, str]]:
    first = await fetch_page(client, selector, 1)
    data = first.get("data") or {}
    total = int(data.get("total") or 0)
    rows = list(data.get("diff") or [])
    pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
    semaphore = asyncio.Semaphore(6)

    async def one(page: int) -> list[dict[str, Any]]:
        async with semaphore:
            payload = await fetch_page(client, selector, page)
            return list((payload.get("data") or {}).get("diff") or [])

    if pages > 1:
        for chunk_start in range(2, pages + 1, 12):
            chunks = await asyncio.gather(*[
                one(page) for page in range(chunk_start, min(pages + 1, chunk_start + 12))
            ])
            for chunk in chunks:
                rows.extend(chunk)
            await asyncio.sleep(0.25)
    return [item for row in rows if (item := convert(row, kind)) is not None]


async def fetch_page(client: httpx.AsyncClient, selector: str, page: int) -> dict[str, Any]:
    for attempt in range(4):
        try:
            response = await client.get(URL, params={
                "pn": str(page), "pz": str(PAGE_SIZE), "po": "1", "np": "1",
                "fltt": "2", "invt": "2", "fid": "f12", "fs": selector,
                "fields": "f12,f14,f13",
            })
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError):
            if attempt == 3:
                raise
            await asyncio.sleep(0.35 * (attempt + 1))
    return {}


async def main() -> None:
    limits = httpx.Limits(max_connections=8, max_keepalive_connections=8)
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(15, connect=4), limits=limits, trust_env=False,
        headers={"User-Agent": "Mozilla/5.0 stock-analysis-dashboard-indexer/1.0", "Referer": "https://quote.eastmoney.com/"},
    ) as client:
        groups = []
        for kind, selector in MARKETS:
            groups.extend(await fetch_market(client, kind, selector))
    unique = {item["provider_symbol"]: item for item in groups}
    ordered = sorted(unique.values(), key=lambda item: (item["market"], item["symbol"]))
    if len(ordered) < MINIMUM_INSTRUMENTS:
        raise RuntimeError(
            f"Refusing to replace instrument index: expected at least "
            f"{MINIMUM_INSTRUMENTS} instruments, received {len(ordered)}"
        )
    missing = REQUIRED_SYMBOLS.difference(unique)
    if missing:
        raise RuntimeError(
            "Refusing to replace instrument index: representative symbols "
            f"are missing: {', '.join(sorted(missing))}"
        )
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(ordered, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    decoded = json.loads(temporary.read_text(encoding="utf-8"))
    if len(decoded) != len(ordered):
        temporary.unlink(missing_ok=True)
        raise RuntimeError("Generated instrument index failed round-trip validation")
    temporary.replace(OUTPUT)
    print(f"Wrote {len(ordered)} instruments to {OUTPUT} ({OUTPUT.stat().st_size / 1024:.1f} KiB)")


if __name__ == "__main__":
    asyncio.run(main())
