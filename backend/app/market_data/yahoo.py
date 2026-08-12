from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from .base import ProviderError
from .models import Adjustment, BarPayload, QuoteResponse, Timeframe
from .symbols import Instrument


class YahooProvider:
    """Secondary provider used only when the primary public feed fails.

    Yahoo's chart payload is useful as an independent cross-provider fallback.
    It does not expose A-share turnover/amount, so callers keep those fields
    empty and surface the reduced-data warning instead of fabricating values.
    """

    name = "yahoo-chart"
    chart_url = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"

    def __init__(self, timeout_seconds: float = 7.0, client: httpx.AsyncClient | None = None):
        self._owns_client = client is None
        self.client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_seconds, connect=min(2.5, timeout_seconds)),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=8, keepalive_expiry=30),
            trust_env=False,
            headers={"User-Agent": "Mozilla/5.0 stock-analysis-dashboard/1.0"},
        )

    async def close(self) -> None:
        if self._owns_client:
            await self.client.aclose()

    @staticmethod
    def _symbol(instrument: Instrument) -> str:
        if instrument.exchange == "SZSE":
            return f"{instrument.symbol}.SZ"
        if instrument.exchange == "SSE":
            return f"{instrument.symbol}.SS"
        if instrument.exchange == "BSE":
            return f"{instrument.symbol}.BJ"
        # Yahoo uses four digits for the common HK symbols (00700 -> 0700).
        return f"{instrument.symbol[-4:]}.HK"

    async def _get(self, instrument: Instrument, interval: str, range_: str) -> dict[str, Any]:
        url = self.chart_url.format(symbol=self._symbol(instrument))
        response = await self.client.get(
            url,
            params={"interval": interval, "range": range_, "events": "div,splits"},
        )
        response.raise_for_status()
        payload = response.json()
        chart = payload.get("chart", {})
        if chart.get("error"):
            raise ProviderError(str(chart["error"]))
        results = chart.get("result") or []
        if not results:
            raise ProviderError(f"No Yahoo chart data for {self._symbol(instrument)}")
        return results[0]

    @staticmethod
    def _name(node: dict[str, Any]) -> str | None:
        meta = node.get("meta", {})
        return meta.get("longName") or meta.get("shortName")

    @staticmethod
    def _bars(node: dict[str, Any], adjustment: Adjustment, limit: int) -> list[BarPayload]:
        timestamps = node.get("timestamp") or []
        indicators = node.get("indicators", {})
        quote_nodes = indicators.get("quote") or []
        if not quote_nodes:
            return []
        quote = quote_nodes[0]
        adjusted_nodes = indicators.get("adjclose") or []
        adjusted = adjusted_nodes[0].get("adjclose", []) if adjusted_nodes else []
        meta = node.get("meta", {})
        timezone_name = meta.get("exchangeTimezoneName") or "Asia/Shanghai"
        try:
            timezone = ZoneInfo(timezone_name)
        except (KeyError, ValueError):
            timezone = ZoneInfo("Asia/Shanghai")

        opens = quote.get("open") or []
        highs = quote.get("high") or []
        lows = quote.get("low") or []
        closes = quote.get("close") or []
        volumes = quote.get("volume") or []
        first_scale = 1.0
        if adjustment == "hfq":
            for index, raw_close in enumerate(closes):
                adjusted_close = adjusted[index] if index < len(adjusted) else None
                if raw_close and adjusted_close:
                    first_scale = float(raw_close) / float(adjusted_close)
                    break

        bars: list[BarPayload] = []
        for index, timestamp in enumerate(timestamps):
            values = [
                opens[index] if index < len(opens) else None,
                highs[index] if index < len(highs) else None,
                lows[index] if index < len(lows) else None,
                closes[index] if index < len(closes) else None,
            ]
            if any(value is None for value in values):
                continue
            raw_close = float(values[3])
            adjusted_close = adjusted[index] if index < len(adjusted) else None
            factor = float(adjusted_close) / raw_close if adjustment != "none" and adjusted_close and raw_close else 1.0
            if adjustment == "hfq":
                factor *= first_scale
            clock = datetime.fromtimestamp(int(timestamp), timezone)
            time = clock.strftime("%Y-%m-%d") if str(meta.get("dataGranularity", "")).endswith("d") else clock.strftime("%Y-%m-%d %H:%M")
            bars.append(BarPayload(
                time=time,
                open=round(float(values[0]) * factor, 4),
                high=round(float(values[1]) * factor, 4),
                low=round(float(values[2]) * factor, 4),
                close=round(raw_close * factor, 4),
                volume=float(volumes[index] or 0) if index < len(volumes) else 0,
            ))
        return bars[-limit:]

    async def daily_bars(
        self, instrument: Instrument, adjustment: Adjustment, limit: int
    ) -> tuple[list[BarPayload], str | None, dict[str, Any]]:
        # Yahoo silently coarsens `range=max&interval=1d` to monthly data for
        # long-lived symbols. Ten years retains true daily bars and still
        # covers the service's 2,000-bar maximum.
        node = await self._get(instrument, "1d", "10y")
        bars = self._bars(node, adjustment, limit)
        if not bars:
            raise ProviderError(f"No Yahoo daily data for {self._symbol(instrument)}")
        return bars, self._name(node), node

    async def minute_bars(
        self, instrument: Instrument, timeframe: Timeframe, limit: int
    ) -> tuple[list[BarPayload], str | None, dict[str, Any]]:
        interval = {"1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "60m": "60m"}.get(timeframe)
        if interval is None:
            raise ProviderError(f"Unsupported Yahoo minute timeframe: {timeframe}")
        range_ = "5d" if timeframe == "1m" else "1mo"
        node = await self._get(instrument, interval, range_)
        bars = self._bars(node, "none", limit)
        if not bars:
            raise ProviderError(f"No Yahoo minute data for {self._symbol(instrument)}")
        return bars, self._name(node), node

    def quote_from_node(self, instrument: Instrument, node: dict[str, Any], name: str | None) -> QuoteResponse | None:
        meta = node.get("meta", {})
        last = meta.get("regularMarketPrice")
        if last is None:
            return None
        timestamp = meta.get("regularMarketTime")
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
            last=float(last),
            previous_close=float(meta["chartPreviousClose"]) if meta.get("chartPreviousClose") is not None else None,
            high=float(meta["regularMarketDayHigh"]) if meta.get("regularMarketDayHigh") is not None else None,
            low=float(meta["regularMarketDayLow"]) if meta.get("regularMarketDayLow") is not None else None,
            volume=float(meta["regularMarketVolume"]) if meta.get("regularMarketVolume") is not None else None,
            timestamp=datetime.fromtimestamp(int(timestamp), UTC).isoformat() if timestamp else None,
            source=self.name,
            delayed=True,
            fallback_used=True,
            quality_issues=["备用源不提供成交额与换手率"],
        )
