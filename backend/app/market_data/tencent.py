from datetime import UTC, datetime
from typing import Any

import httpx

from .models import Adjustment, BarPayload, QuoteResponse, Timeframe
from .symbols import Instrument
from .aggregate import aggregate_minute_bars


class ProviderError(RuntimeError):
    pass


class TencentProvider:
    name = "tencent-public"
    daily_url = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
    minute_url = "https://ifzq.gtimg.cn/appstock/app/kline/mkline"
    latest_minute_url = "https://web.ifzq.gtimg.cn/appstock/app/minute/query"

    def __init__(self, timeout_seconds: float = 12.0):
        self.timeout = httpx.Timeout(timeout_seconds)

    async def _get(self, url: str, params: dict[str, str]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout, trust_env=False) as client:
            response = await client.get(url, params=params, headers={"User-Agent": "stock-analysis-dashboard/0.3"})
            response.raise_for_status()
            payload = response.json()
        if payload.get("code") != 0:
            raise ProviderError(payload.get("msg") or "Market-data provider returned an error")
        return payload

    @staticmethod
    def _volume_multiplier(instrument: Instrument) -> int:
        return 100 if instrument.market == "CN" else 1

    @staticmethod
    def _instrument_name(payload: dict[str, Any], provider_symbol: str) -> str | None:
        quote = payload.get("qt", {}).get(provider_symbol, [])
        return str(quote[1]) if len(quote) > 1 else None

    async def daily_bars(
        self,
        instrument: Instrument,
        adjustment: Adjustment,
        limit: int,
    ) -> tuple[list[BarPayload], str | None, dict[str, Any]]:
        suffix = {"none": "", "qfq": "qfq", "hfq": "hfq"}[adjustment]
        param = f"{instrument.provider_symbol},day,,,{limit},{suffix}"
        payload = await self._get(self.daily_url, {"param": param})
        node = payload.get("data", {}).get(instrument.provider_symbol)
        if not node:
            raise ProviderError(f"No daily data for {instrument.provider_symbol}")
        preferred_key = {"none": "day", "qfq": "qfqday", "hfq": "hfqday"}[adjustment]
        rows = node.get(preferred_key) or node.get("day") or node.get("qfqday") or []
        multiplier = self._volume_multiplier(instrument)
        bars = [
            BarPayload(
                time=str(row[0]),
                open=float(row[1]),
                close=float(row[2]),
                high=float(row[3]),
                low=float(row[4]),
                volume=float(row[5]) * multiplier,
            )
            for row in rows
            if len(row) >= 6
        ]
        return bars, self._instrument_name(node, instrument.provider_symbol), node

    async def minute_bars(
        self,
        instrument: Instrument,
        timeframe: Timeframe,
        limit: int,
    ) -> tuple[list[BarPayload], str | None, dict[str, Any]]:
        if timeframe not in {"1m", "5m", "15m", "30m", "60m"}:
            raise ProviderError(f"Unsupported minute timeframe: {timeframe}")
        if instrument.market == "HK":
            return await self._latest_hk_minute_bars(instrument, timeframe)
        provider_timeframe = timeframe.replace("m", "")
        key = f"m{provider_timeframe}"
        payload = await self._get(
            self.minute_url,
            {"param": f"{instrument.provider_symbol},{key},,{limit}"},
        )
        node = payload.get("data", {}).get(instrument.provider_symbol)
        if not node:
            raise ProviderError(f"No minute data for {instrument.provider_symbol}")
        rows = node.get(key, [])
        multiplier = self._volume_multiplier(instrument)
        bars = [
            BarPayload(
                time=f"{row[0][0:4]}-{row[0][4:6]}-{row[0][6:8]} {row[0][8:10]}:{row[0][10:12]}",
                open=float(row[1]),
                close=float(row[2]),
                high=float(row[3]),
                low=float(row[4]),
                volume=float(row[5]) * multiplier,
                amount=float(row[7]) * 10_000 if len(row) > 7 and row[7] not in (None, "") else None,
            )
            for row in rows
            if len(row) >= 6 and len(str(row[0])) >= 12
        ]
        return bars, self._instrument_name(node, instrument.provider_symbol), node

    async def _latest_hk_minute_bars(
        self,
        instrument: Instrument,
        timeframe: Timeframe,
    ) -> tuple[list[BarPayload], str | None, dict[str, Any]]:
        payload = await self._get(self.latest_minute_url, {"code": instrument.provider_symbol})
        node = payload.get("data", {}).get(instrument.provider_symbol)
        if not node:
            raise ProviderError(f"No minute data for {instrument.provider_symbol}")
        data_node = node.get("data", {})
        trading_date = str(data_node.get("date", ""))
        rows = data_node.get("data", [])
        if len(trading_date) != 8 or not rows:
            raise ProviderError(f"No latest-session minute data for {instrument.provider_symbol}")

        date_text = f"{trading_date[0:4]}-{trading_date[4:6]}-{trading_date[6:8]}"
        previous_volume = 0.0
        previous_amount = 0.0
        minute_bars: list[BarPayload] = []
        for row in rows:
            parts = str(row).split()
            if len(parts) < 4:
                continue
            clock, price_text, cumulative_volume_text, cumulative_amount_text = parts[:4]
            price = float(price_text)
            cumulative_volume = float(cumulative_volume_text)
            cumulative_amount = float(cumulative_amount_text)
            volume = max(0.0, cumulative_volume - previous_volume)
            amount = max(0.0, cumulative_amount - previous_amount)
            previous_volume = cumulative_volume
            previous_amount = cumulative_amount
            minute_bars.append(
                BarPayload(
                    time=f"{date_text} {clock[:2]}:{clock[2:4]}",
                    open=price,
                    high=price,
                    low=price,
                    close=price,
                    volume=volume,
                    amount=amount,
                )
            )
        interval = int(timeframe.removesuffix("m"))
        bars = minute_bars if interval == 1 else aggregate_minute_bars(minute_bars, interval)
        return bars, self._instrument_name(node, instrument.provider_symbol), node

    def quote_from_node(self, instrument: Instrument, node: dict[str, Any], name: str | None) -> QuoteResponse | None:
        quote = node.get("qt", {}).get(instrument.provider_symbol, [])
        if len(quote) < 35:
            return None
        multiplier = self._volume_multiplier(instrument)
        return QuoteResponse(
            instrument={
                "symbol": instrument.symbol,
                "key": instrument.key,
                "market": instrument.market,
                "exchange": instrument.exchange,
                "provider_symbol": instrument.provider_symbol,
                "currency": instrument.currency,
                "name": name,
            },
            last=float(quote[3]),
            previous_close=float(quote[4]),
            open=float(quote[5]),
            high=float(quote[33]),
            low=float(quote[34]),
            volume=float(quote[6]) * multiplier,
            timestamp=str(quote[30]) if len(quote) > 30 else None,
            source=self.name,
            delayed=True,
        )

    @staticmethod
    def fetched_at() -> datetime:
        return datetime.now(UTC)
