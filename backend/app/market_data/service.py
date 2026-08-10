from datetime import UTC, datetime
from pathlib import Path

from .aggregate import aggregate_bars
from .cache import JsonCache
from .models import Adjustment, BarsResponse, InstrumentPayload, QuoteResponse, Timeframe
from .symbols import Instrument, normalize_symbol
from .tencent import TencentProvider


class MarketDataService:
    def __init__(self, cache_root: Path, provider: TencentProvider | None = None):
        self.cache = JsonCache(cache_root)
        self.provider = provider or TencentProvider()

    @staticmethod
    def resolve(raw: str, name: str | None = None) -> InstrumentPayload:
        instrument = normalize_symbol(raw)
        return InstrumentPayload(
            symbol=instrument.symbol,
            key=instrument.key,
            market=instrument.market,
            exchange=instrument.exchange,
            provider_symbol=instrument.provider_symbol,
            currency=instrument.currency,
            name=name,
        )

    @staticmethod
    def _ttl(timeframe: Timeframe) -> int:
        return 120 if timeframe.endswith("m") else 14_400

    async def get_bars(
        self,
        raw_symbol: str,
        timeframe: Timeframe,
        adjustment: Adjustment,
        limit: int,
        refresh: bool = False,
        trading_date: str | None = None,
    ) -> BarsResponse:
        instrument: Instrument = normalize_symbol(raw_symbol)
        normalized_limit = max(1, min(limit, 2000))
        cache_key = f"{instrument.provider_symbol}-{timeframe}-{adjustment}"
        cached_value = None if refresh else self.cache.get(cache_key, self._ttl(timeframe))
        if cached_value and cached_value.get("requested_limit", 0) >= normalized_limit:
            response = BarsResponse.model_validate(cached_value)
            response.cached = True
        else:
            stale_value = self.cache.get_any(cache_key)
            requested_timeframe = timeframe
            if timeframe in {"1w", "1M"}:
                daily, name, _ = await self.provider.daily_bars(instrument, adjustment, min(2000, normalized_limit * 7))
                bars = aggregate_bars(daily, timeframe)
                applied_adjustment = adjustment
            elif timeframe == "1d":
                bars, name, _ = await self.provider.daily_bars(instrument, adjustment, normalized_limit)
                applied_adjustment = adjustment
            else:
                bars, name, _ = await self.provider.minute_bars(instrument, timeframe, normalized_limit)
                applied_adjustment = "none"
            if stale_value:
                stale_response = BarsResponse.model_validate(stale_value)
                merged = {bar.time: bar for bar in stale_response.bars}
                merged.update({bar.time: bar for bar in bars})
                bars = [merged[key] for key in sorted(merged)][-2000:]
            response = BarsResponse(
                instrument=self.resolve(raw_symbol, name),
                timeframe=requested_timeframe,
                adjustment=adjustment,
                adjustment_applied=applied_adjustment,
                source=self.provider.name,
                fetched_at=datetime.now(UTC),
                cached=False,
                delayed=True,
                requested_limit=normalized_limit,
                bars=bars,
            )
            self.cache.set(cache_key, response.model_dump(mode="json"))

        response.bars = response.bars[-normalized_limit:]
        if trading_date:
            response.bars = [bar for bar in response.bars if bar.time.startswith(trading_date)]
        return response

    async def get_quote(self, raw_symbol: str) -> QuoteResponse:
        instrument = normalize_symbol(raw_symbol)
        bars, name, node = await self.provider.daily_bars(instrument, "qfq", 2)
        quote = self.provider.quote_from_node(instrument, node, name)
        if quote is not None:
            return quote
        if not bars:
            raise ValueError(f"No quote data for {instrument.key}")
        last = bars[-1]
        previous = bars[-2].close if len(bars) > 1 else None
        return QuoteResponse(
            instrument=self.resolve(raw_symbol, name),
            last=last.close,
            previous_close=previous,
            open=last.open,
            high=last.high,
            low=last.low,
            volume=last.volume,
            timestamp=last.time,
            source=self.provider.name,
            delayed=True,
        )
