from datetime import UTC, datetime
import json
import re
from typing import Any

import httpx

from .models import Adjustment, BarPayload, InstrumentSearchResult, QuoteResponse, Timeframe
from .symbols import Instrument, SymbolError, normalize_symbol
from .aggregate import aggregate_minute_bars
from .base import ProviderError


class TencentProvider:
    name = "tencent-public"
    daily_url = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
    minute_url = "https://ifzq.gtimg.cn/appstock/app/kline/mkline"
    multi_day_minute_url = "https://web.ifzq.gtimg.cn/appstock/app/day/query"
    search_url = "https://smartbox.gtimg.cn/s3/"

    def __init__(self, timeout_seconds: float = 7.0, client: httpx.AsyncClient | None = None):
        self._owns_client = client is None
        self.client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_seconds, connect=min(2.5, timeout_seconds)),
            limits=httpx.Limits(max_connections=30, max_keepalive_connections=10, keepalive_expiry=30),
            trust_env=False,
            headers={"User-Agent": "stock-analysis-dashboard/1.0"},
        )

    async def close(self) -> None:
        if self._owns_client:
            await self.client.aclose()

    async def _get(self, url: str, params: dict[str, str]) -> dict[str, Any]:
        response = await self.client.get(url, params=params)
        response.raise_for_status()
        payload = response.json()
        if payload.get("code") != 0:
            raise ProviderError(payload.get("msg") or "Market-data provider returned an error")
        return payload

    async def _get_text(self, url: str, params: dict[str, str]) -> str:
        response = await self.client.get(url, params=params)
        response.raise_for_status()
        return response.text

    @staticmethod
    def _parse_search_payload(payload: str, query: str, limit: int) -> list[InstrumentSearchResult]:
        match = re.search(r"v_hint\s*=\s*(\"(?:\\.|[^\"])*\")", payload)
        if not match:
            return []
        try:
            decoded = json.loads(match.group(1))
        except json.JSONDecodeError:
            return []

        supported: list[tuple[int, InstrumentSearchResult, str]] = []
        seen: set[str] = set()
        normalized_query = query.strip().lower()
        for provider_index, raw_item in enumerate(str(decoded).split("^")):
            parts = raw_item.split("~")
            if len(parts) < 5:
                continue
            prefix, code, name, pinyin, category = parts[:5]
            if prefix not in {"sh", "sz", "bj", "hk"}:
                continue
            if prefix == "hk":
                if category != "GP":
                    continue
            elif category not in {"GP-A", "ETF"}:
                continue
            try:
                instrument = normalize_symbol(f"{prefix}{code}")
            except SymbolError:
                continue
            if instrument.key in seen:
                continue
            seen.add(instrument.key)
            name_text = str(name).strip()
            code_starts = code.startswith(normalized_query)
            if normalized_query.isdigit():
                rank = 0 if code_starts else 10
            else:
                lower_name = name_text.lower()
                rank = (
                    0 if lower_name == normalized_query
                    else 1 if lower_name.startswith(normalized_query)
                    else 2 if normalized_query in lower_name
                    else 3 if str(pinyin).lower().startswith(normalized_query)
                    else 10
                )
            supported.append((rank * 1000 + provider_index, InstrumentSearchResult(
                input=instrument.provider_symbol,
                symbol=instrument.symbol,
                name=name_text,
                market=instrument.market,
                exchange=instrument.exchange,
                provider_symbol=instrument.provider_symbol,
                asset_type="etf" if category == "ETF" else "stock",
            ), code))

        if normalized_query.isdigit() and any(code.startswith(normalized_query) for _, _, code in supported):
            supported = [item for item in supported if item[2].startswith(normalized_query)]
        return [item[1] for item in sorted(supported, key=lambda item: item[0])[:max(1, min(limit, 10))]]

    async def search_instruments(self, query: str, limit: int = 5) -> list[InstrumentSearchResult]:
        value = query.strip()
        if not value:
            return []
        payload = await self._get_text(self.search_url, {"q": value, "t": "all"})
        return self._parse_search_payload(payload, value, limit)

    @staticmethod
    def _volume_multiplier(instrument: Instrument) -> int:
        return 100 if instrument.market == "CN" else 1

    @staticmethod
    def _instrument_name(payload: dict[str, Any], provider_symbol: str) -> str | None:
        quote = payload.get("qt", {}).get(provider_symbol, [])
        return str(quote[1]) if len(quote) > 1 else None

    @staticmethod
    def _circulating_shares(payload: dict[str, Any], provider_symbol: str) -> float | None:
        """Return the provider's current circulating-share count for A shares.

        Tencent's quote payload exposes circulating shares at field 72.  The
        historical kline rows do not expose turnover, so this lets us derive a
        documented end-of-day estimate instead of using relative volume as a
        silent proxy.
        """
        quote = payload.get("qt", {}).get(provider_symbol, [])
        if len(quote) <= 72:
            return None
        try:
            value = float(quote[72])
        except (TypeError, ValueError):
            return None
        return value if value > 0 else None

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
        rows = node.get(preferred_key) or []
        if not rows:
            raise ProviderError(f"No {preferred_key} data for {instrument.provider_symbol}")
        multiplier = self._volume_multiplier(instrument)
        circulating_shares = self._circulating_shares(node, instrument.provider_symbol) if instrument.market == "CN" else None
        bars = [
            BarPayload(
                time=str(row[0]),
                open=float(row[1]),
                close=float(row[2]),
                high=float(row[3]),
                low=float(row[4]),
                volume=float(row[5]) * multiplier,
                turnover_rate=(float(row[5]) * multiplier / circulating_shares) if circulating_shares else None,
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
            return await self._hk_minute_bars(instrument, timeframe, limit)
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

    @staticmethod
    def _parse_hk_minute_sessions(node: dict[str, Any]) -> list[BarPayload]:
        raw_sessions = node.get("data", [])
        sessions = [raw_sessions] if isinstance(raw_sessions, dict) else raw_sessions
        minute_bars: list[BarPayload] = []
        for data_node in sessions:
            if not isinstance(data_node, dict):
                continue
            trading_date = str(data_node.get("date", ""))
            rows = data_node.get("data", [])
            if len(trading_date) != 8 or not rows:
                continue

            date_text = f"{trading_date[0:4]}-{trading_date[4:6]}-{trading_date[6:8]}"
            previous_volume = 0.0
            previous_amount = 0.0
            for row in rows:
                parts = str(row).split()
                if len(parts) < 4:
                    continue
                clock, price_text, cumulative_volume_text, cumulative_amount_text = parts[:4]
                try:
                    price = float(price_text)
                    cumulative_volume = float(cumulative_volume_text)
                    cumulative_amount = float(cumulative_amount_text)
                except ValueError:
                    continue
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
        return sorted(minute_bars, key=lambda bar: bar.time)

    async def _hk_minute_bars(
        self,
        instrument: Instrument,
        timeframe: Timeframe,
        limit: int,
    ) -> tuple[list[BarPayload], str | None, dict[str, Any]]:
        payload = await self._get(self.multi_day_minute_url, {"code": instrument.provider_symbol})
        node = payload.get("data", {}).get(instrument.provider_symbol)
        if not node:
            raise ProviderError(f"No minute data for {instrument.provider_symbol}")
        minute_bars = self._parse_hk_minute_sessions(node)
        if not minute_bars:
            raise ProviderError(f"No recent-session minute data for {instrument.provider_symbol}")
        interval = int(timeframe.removesuffix("m"))
        bars = minute_bars if interval == 1 else aggregate_minute_bars(minute_bars, interval)
        return bars[-limit:], self._instrument_name(node, instrument.provider_symbol), node

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
